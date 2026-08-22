import { describe, it, expect, afterEach } from 'vitest'
import type { DataConnectionDocument } from '@vibesboard/contracts'
import {
  createDataProvider,
  GoogleSheetsProvider,
  AirtableProvider,
  CustomWebhookProvider,
} from '../providers/index.ts'

// All providers ultimately call globalThis.fetch; stub it so the tests are
// offline + deterministic. Each stub records the (url, init) of every call.
const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(responses: Response | Response[]) {
  const queue = Array.isArray(responses) ? [...responses] : [responses]
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: typeof url === 'string' ? url : String(url), init })
    // Repeat the last response if the queue runs dry.
    return queue.length > 1 ? queue.shift()! : queue[0]
  }) as unknown as typeof fetch
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function authHeader(init?: RequestInit): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.Authorization
}

// ─── createDataProvider factory ───────────────────────────────────────

describe('createDataProvider', () => {
  function baseConnection(
    overrides: Partial<DataConnectionDocument>,
  ): DataConnectionDocument {
    return {
      id: 'c1',
      tenantId: 't1',
      provider: 'google_sheets',
      name: 'n',
      status: 'active',
      connectedBy: 'u1',
      connectedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    } as DataConnectionDocument
  }

  it('builds a GoogleSheetsProvider for google_sheets', () => {
    const p = createDataProvider(
      baseConnection({ provider: 'google_sheets', spreadsheetId: 'ss1' }),
      'tok',
    )
    expect(p).toBeInstanceOf(GoogleSheetsProvider)
  })

  it('builds an AirtableProvider for airtable', () => {
    const p = createDataProvider(
      baseConnection({ provider: 'airtable', baseId: 'b', tableId: 'tbl' }),
      'tok',
    )
    expect(p).toBeInstanceOf(AirtableProvider)
  })

  it('builds a CustomWebhookProvider for custom_webhook', () => {
    const p = createDataProvider(
      baseConnection({
        provider: 'custom_webhook',
        webhookUrl: 'https://example.com/hook',
      }),
      '',
    )
    expect(p).toBeInstanceOf(CustomWebhookProvider)
  })

  it('defaults sheetName to Sheet1 when omitted', async () => {
    // appendRow makes two fetches: getHeaders (range Sheet1!1:1) then append.
    // Each needs its own Response since a body can only be read once.
    const calls = stubFetch([
      jsonResponse({ values: [['a']] }), // existing headers cover field "a"
      jsonResponse({ updates: { updatedRange: 'Sheet1!A2' } }), // append
    ])
    const p = createDataProvider(
      baseConnection({ provider: 'google_sheets', spreadsheetId: 'ss1' }),
      'tok',
    )
    await p.appendRow({ a: 1 })
    expect(calls[0].url).toContain(encodeURIComponent('Sheet1!1:1'))
  })

  it('throws for an unsupported provider', () => {
    expect(() =>
      createDataProvider(
        baseConnection({ provider: 'bogus' as any }),
        'tok',
      ),
    ).toThrow(/Unsupported data provider: bogus/)
  })
})

// ─── GoogleSheetsProvider ─────────────────────────────────────────────

describe('GoogleSheetsProvider.appendRow', () => {
  it('writes headers first on an empty sheet then appends the row', async () => {
    // 1) getHeaders → empty, 2) PUT new headers, 3) append row.
    const calls = stubFetch([
      jsonResponse({}), // getHeaders: no values
      jsonResponse({}), // ensureHeaders PUT
      jsonResponse({ updates: { updatedRange: 'Sheet1!A2:B2' } }), // append
    ])
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Leads',
    })
    const result = await p.appendRow({ Name: 'Ada', Email: 'a@x.com' })

    expect(result.success).toBe(true)
    expect(result.externalRef).toBe('Sheet1!A2:B2')

    // Header write goes to Sheet range A1 with the field names.
    const putCall = calls[1]
    expect(putCall.init?.method).toBe('PUT')
    expect(putCall.url).toContain(encodeURIComponent('Leads!A1'))
    expect(JSON.parse(putCall.init?.body as string)).toEqual({
      values: [['Name', 'Email']],
    })

    // Append posts the row (ordered by header) to the values:append endpoint.
    const appendCall = calls[2]
    expect(appendCall.init?.method).toBe('POST')
    expect(appendCall.url).toContain('/values/')
    expect(appendCall.url).toContain('append?valueInputOption=USER_ENTERED')
    expect(authHeader(appendCall.init)).toBe('Bearer tok')
    expect(JSON.parse(appendCall.init?.body as string)).toEqual({
      values: [['Ada', 'a@x.com']],
    })
  })

  it('orders row values by the existing header order and blanks missing fields', async () => {
    const calls = stubFetch([
      jsonResponse({ values: [['Email', 'Name', 'Phone']] }), // existing headers
      jsonResponse({ updates: { updatedRange: 'Sheet1!A5' } }), // append
    ])
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
    })
    // Provide only Name + Email (Phone left blank); headers already cover them.
    await p.appendRow({ Name: 'Ada', Email: 'a@x.com' })

    const appendBody = JSON.parse(calls[1].init?.body as string)
    expect(appendBody).toEqual({ values: [['a@x.com', 'Ada', '']] })
  })

  it('throws on a non-ok append response', async () => {
    stubFetch([
      jsonResponse({ values: [['Name']] }), // headers ok
      jsonResponse({ error: { message: 'quota' } }, 429), // append fails
    ])
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
    })
    await expect(p.appendRow({ Name: 'Ada' })).rejects.toThrow(
      /Google Sheets append error 429: quota/,
    )
  })

  it('testConnection returns ok on a 200', async () => {
    stubFetch(jsonResponse({ properties: { title: 'Sheet' } }))
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
    })
    expect(await p.testConnection()).toEqual({ ok: true })
  })

  it('testConnection returns an error on a non-200', async () => {
    stubFetch(new Response('', { status: 403 }))
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
    })
    expect(await p.testConnection()).toEqual({ ok: false, error: 'HTTP 403' })
  })
})

describe('GoogleSheetsProvider.updateRow', () => {
  it('returns matched:false when the key value is not present', async () => {
    stubFetch([
      jsonResponse({ values: [['Name', 'Email']] }), // headers
      jsonResponse({ values: [['Name'], ['Bob']] }), // key column (no "Ada")
    ])
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
    })
    const result = await p.updateRow('Name', 'Ada', { Email: 'x' })
    expect(result).toEqual({ success: false, matched: false })
  })

  it('throws when the key field is missing from the headers', async () => {
    stubFetch(jsonResponse({ values: [['Email']] }))
    const p = new GoogleSheetsProvider({
      accessToken: 'tok',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
    })
    await expect(p.updateRow('Name', 'Ada', { Email: 'x' })).rejects.toThrow(
      /Key field "Name" not found/,
    )
  })
})

// ─── AirtableProvider ─────────────────────────────────────────────────

describe('AirtableProvider.appendRow', () => {
  it('POSTs fields and returns the created record id', async () => {
    const calls = stubFetch(jsonResponse({ id: 'recABC' }))
    const p = new AirtableProvider({
      apiToken: 'pat',
      baseId: 'base1',
      tableId: 'tbl1',
    })
    const result = await p.appendRow({ Name: 'Ada' })

    expect(result).toEqual({ success: true, externalRef: 'recABC' })
    const { url, init } = calls[0]
    expect(url).toBe('https://api.airtable.com/v0/base1/tbl1')
    expect(init?.method).toBe('POST')
    expect(authHeader(init)).toBe('Bearer pat')
    expect(JSON.parse(init?.body as string)).toEqual({ fields: { Name: 'Ada' } })
  })

  it('throws on a non-ok response including the API error message', async () => {
    stubFetch(jsonResponse({ error: { message: 'INVALID_API_KEY' } }, 401))
    const p = new AirtableProvider({
      apiToken: 'pat',
      baseId: 'base1',
      tableId: 'tbl1',
    })
    await expect(p.appendRow({ Name: 'Ada' })).rejects.toThrow(
      /Airtable error 401: INVALID_API_KEY/,
    )
  })
})

describe('AirtableProvider.updateRow', () => {
  it('searches then PATCHes the matched record', async () => {
    const calls = stubFetch([
      jsonResponse({ records: [{ id: 'rec1' }] }), // search
      jsonResponse({ id: 'rec1' }), // patch
    ])
    const p = new AirtableProvider({
      apiToken: 'pat',
      baseId: 'base1',
      tableId: 'tbl1',
    })
    const result = await p.updateRow('Email', 'a@x.com', { Name: 'Ada' })
    expect(result).toEqual({ success: true, matched: true, externalRef: 'rec1' })

    // Search uses a filterByFormula on the key field/value.
    expect(calls[0].url).toContain('filterByFormula=')
    expect(calls[0].init?.method).toBe('GET')
    // Patch targets the matched record id.
    expect(calls[1].url).toBe('https://api.airtable.com/v0/base1/tbl1/rec1')
    expect(calls[1].init?.method).toBe('PATCH')
  })

  it('returns matched:false when no record matches', async () => {
    stubFetch(jsonResponse({ records: [] }))
    const p = new AirtableProvider({
      apiToken: 'pat',
      baseId: 'base1',
      tableId: 'tbl1',
    })
    expect(await p.updateRow('Email', 'nope', { Name: 'x' })).toEqual({
      success: false,
      matched: false,
    })
  })
})

describe('AirtableProvider.testConnection', () => {
  it('returns ok on a 200', async () => {
    stubFetch(jsonResponse({ records: [] }))
    const p = new AirtableProvider({
      apiToken: 'pat',
      baseId: 'base1',
      tableId: 'tbl1',
    })
    expect(await p.testConnection()).toEqual({ ok: true })
  })

  it('returns an error string on a non-ok response', async () => {
    stubFetch(jsonResponse({ error: { message: 'NOT_FOUND' } }, 404))
    const p = new AirtableProvider({
      apiToken: 'pat',
      baseId: 'base1',
      tableId: 'tbl1',
    })
    const result = await p.testConnection()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('404')
    expect(result.error).toContain('NOT_FOUND')
  })
})

// ─── CustomWebhookProvider ────────────────────────────────────────────

describe('CustomWebhookProvider.appendRow', () => {
  it('POSTs an {action:"append", data, timestamp} envelope', async () => {
    const calls = stubFetch(new Response('ok', { status: 200 }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'POST',
      headers: { 'X-Token': 'abc' },
    })
    const result = await p.appendRow({ Name: 'Ada' })

    expect(result).toEqual({ success: true })
    const { url, init } = calls[0]
    expect(url).toBe('https://example.com/hook')
    expect(init?.method).toBe('POST')
    const headers = init?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Token']).toBe('abc')
    const body = JSON.parse(init?.body as string)
    expect(body.action).toBe('append')
    expect(body.data).toEqual({ Name: 'Ada' })
    expect(typeof body.timestamp).toBe('string')
  })

  it('honors a PUT method', async () => {
    const calls = stubFetch(new Response('ok', { status: 200 }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'PUT',
    })
    await p.appendRow({ a: 1 })
    expect(calls[0].init?.method).toBe('PUT')
  })

  it('throws on a non-ok webhook response with status + body', async () => {
    stubFetch(new Response('boom', { status: 502 }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'POST',
    })
    await expect(p.appendRow({ a: 1 })).rejects.toThrow(
      /Webhook returned 502: boom/,
    )
  })
})

describe('CustomWebhookProvider.updateRow', () => {
  it('returns body.matched when the webhook reports it', async () => {
    stubFetch(jsonResponse({ matched: false }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'POST',
    })
    expect(await p.updateRow('k', 'v', { a: 1 })).toEqual({
      success: true,
      matched: false,
    })
  })

  it('defaults matched:true when the webhook body is not informative', async () => {
    stubFetch(new Response('', { status: 200 }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'POST',
    })
    expect(await p.updateRow('k', 'v', { a: 1 })).toEqual({
      success: true,
      matched: true,
    })
  })
})

describe('CustomWebhookProvider.testConnection', () => {
  it('returns ok on a 200', async () => {
    stubFetch(new Response('', { status: 200 }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'POST',
    })
    expect(await p.testConnection()).toEqual({ ok: true })
  })

  it('returns an HTTP error on a non-ok response', async () => {
    stubFetch(new Response('', { status: 500 }))
    const p = new CustomWebhookProvider({
      webhookUrl: 'https://example.com/hook',
      method: 'POST',
    })
    expect(await p.testConnection()).toEqual({ ok: false, error: 'HTTP 500' })
  })
})
