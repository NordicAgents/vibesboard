import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// safeFetch (inside api-client) DNS-resolves the host before calling fetch.
// These tests use a non-resolving example host and assert the transport
// contract, so stub DNS to a fixed public address; the fetch stub below is
// what actually records the requests.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
}))

import {
  validateChatwootCredentials,
  listChatwootInboxes,
  createChatwootWebhook,
  deleteChatwootWebhook,
  sendChatwootMessage,
  createChatwootAgentBot,
  deleteChatwootAgentBot,
  assignAgentBotToInbox,
  unassignAgentBotFromInbox,
  handoffChatwootConversation,
  resumeChatwootConversation
} from '../api-client.ts'

// ─── Outbound fetch stub ─────────────────────────────────────────────
//
// Replace globalThis.fetch with a queue-driven mock that records every
// request so we can assert URL, method, headers, and body without any
// real network access.

interface RecordedCall {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

let calls: RecordedCall[] = []
let responder: (url: string, init: RequestInit) => Response

const originalFetch = globalThis.fetch

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function emptyResponse(status = 200): Response {
  return new Response('', { status })
}

beforeEach(() => {
  calls = []
  responder = () => jsonResponse({})
  globalThis.fetch = vi.fn(async (input: any, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : String(input)
    const headers = (init.headers ?? {}) as Record<string, string>
    let body: unknown = undefined
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    calls.push({ url, method: init.method ?? 'GET', headers, body })
    return responder(url, init)
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('chatwootFetch transport contract (via public functions)', () => {
  it('sends the api_access_token header and JSON content type', async () => {
    responder = () => jsonResponse({ payload: [] })
    await listChatwootInboxes('https://cw.example.com', 'my-token', 5)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.headers.api_access_token).toBe('my-token')
    expect(calls[0]!.headers['Content-Type']).toBe('application/json')
  })

  it('strips trailing slashes from the base url when composing the path', async () => {
    responder = () => jsonResponse({ payload: [] })
    await listChatwootInboxes('https://cw.example.com///', 'tok', 9)
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/9/inboxes'
    )
  })

  it('throws a descriptive error on a non-ok response (with body text)', async () => {
    responder = () =>
      new Response('nope', { status: 403, statusText: 'Forbidden' })
    await expect(
      sendChatwootMessage('https://cw.example.com', 'tok', 1, 2, 'hi')
    ).rejects.toThrow(/Chatwoot API error 403: nope/)
  })

  it('falls back to statusText when the error body is empty', async () => {
    responder = () =>
      new Response('', { status: 500, statusText: 'Internal Server Error' })
    await expect(
      sendChatwootMessage('https://cw.example.com', 'tok', 1, 2, 'hi')
    ).rejects.toThrow(/Chatwoot API error 500: Internal Server Error/)
  })

  it('returns undefined for an empty (no-content) body', async () => {
    // chatwootFetch treats any empty body as undefined regardless of status.
    // (The WHATWG Response constructor in this runtime rejects a body on 204,
    //  so we model "no content" with a 200 + empty string.)
    responder = () => emptyResponse(200)
    const result = await sendChatwootMessage(
      'https://cw.example.com',
      'tok',
      1,
      2,
      'hi'
    )
    expect(result).toBeUndefined()
  })

  it('returns undefined when the body is not valid JSON', async () => {
    responder = () => new Response('not-json', { status: 200 })
    const result = await sendChatwootMessage(
      'https://cw.example.com',
      'tok',
      1,
      2,
      'hi'
    )
    expect(result).toBeUndefined()
  })
})

describe('validateChatwootCredentials', () => {
  it('returns valid with accountId + name when the profile resolves', async () => {
    responder = () =>
      jsonResponse({ id: 1, account_id: 42, name: 'Ada', email: 'a@x.io' })
    const res = await validateChatwootCredentials(
      'https://cw.example.com',
      'tok'
    )
    expect(res).toEqual({ valid: true, accountId: 42, name: 'Ada' })
  })

  it('falls back to email then default name when name is empty', async () => {
    responder = () =>
      jsonResponse({ id: 1, account_id: 42, name: '', email: 'a@x.io' })
    const res = await validateChatwootCredentials(
      'https://cw.example.com',
      'tok'
    )
    expect(res).toEqual({ valid: true, accountId: 42, name: 'a@x.io' })
  })

  it('uses the /api/v1/profile fallback when sign_in rejects', async () => {
    // First call (sign_in) -> 401; second call (profile) -> ok.
    let n = 0
    responder = () => {
      n += 1
      if (n === 1)
        return new Response('bad creds', {
          status: 401,
          statusText: 'Unauthorized'
        })
      return jsonResponse({
        id: 9,
        account_id: 7,
        name: 'Grace',
        email: 'g@x.io'
      })
    }
    const res = await validateChatwootCredentials(
      'https://cw.example.com',
      'tok'
    )
    expect(res).toEqual({ valid: true, accountId: 7, name: 'Grace' })
    expect(calls[0]!.url).toMatch(/\/auth\/sign_in$/)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[1]!.url).toMatch(/\/api\/v1\/profile$/)
  })

  it('returns invalid when no account_id can be determined', async () => {
    responder = () =>
      jsonResponse({ id: 1, name: 'NoAccount', email: 'n@x.io' })
    const res = await validateChatwootCredentials(
      'https://cw.example.com',
      'tok'
    )
    expect(res).toEqual({
      valid: false,
      error: 'Could not determine Chatwoot account ID'
    })
  })

  it('returns invalid when both sign_in and the profile fallback fail', async () => {
    responder = () => new Response('down', { status: 500, statusText: 'err' })
    const res = await validateChatwootCredentials(
      'https://cw.example.com',
      'tok'
    )
    expect(res.valid).toBe(false)
    if (!res.valid) expect(res.error).toMatch(/Chatwoot API error 500/)
  })
})

describe('listChatwootInboxes', () => {
  it('maps the payload array into inbox summaries', async () => {
    responder = () =>
      jsonResponse({
        payload: [
          {
            id: 1,
            name: 'Web',
            channel_type: 'Channel::WebWidget',
            greeting_enabled: true,
            greeting_message: 'hi'
          },
          { id: 2, name: 'Email', channel_type: 'Channel::Email' }
        ]
      })
    const inboxes = await listChatwootInboxes(
      'https://cw.example.com',
      'tok',
      3
    )
    expect(inboxes).toEqual([
      {
        id: 1,
        name: 'Web',
        channel_type: 'Channel::WebWidget',
        greeting_enabled: true,
        greeting_message: 'hi'
      },
      {
        id: 2,
        name: 'Email',
        channel_type: 'Channel::Email',
        greeting_enabled: undefined,
        greeting_message: undefined
      }
    ])
  })

  it('returns an empty array when payload is missing', async () => {
    responder = () => jsonResponse({})
    const inboxes = await listChatwootInboxes(
      'https://cw.example.com',
      'tok',
      3
    )
    expect(inboxes).toEqual([])
  })
})

describe('createChatwootWebhook', () => {
  it('POSTs the webhook url with the message_created subscription', async () => {
    responder = () =>
      jsonResponse({
        id: 100,
        url: 'https://app/hook',
        subscriptions: ['message_created'],
        account_id: 7
      })
    const hook = await createChatwootWebhook(
      'https://cw.example.com',
      'tok',
      7,
      'https://app/hook'
    )
    expect(hook.id).toBe(100)
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/webhooks'
    )
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual({
      url: 'https://app/hook',
      subscriptions: ['message_created']
    })
  })

  it('unwraps a payload-wrapped webhook response', async () => {
    responder = () =>
      jsonResponse({
        payload: {
          id: 200,
          url: 'https://app/hook',
          subscriptions: ['message_created'],
          account_id: 7
        }
      })
    const hook = await createChatwootWebhook(
      'https://cw.example.com',
      'tok',
      7,
      'https://app/hook'
    )
    expect(hook.id).toBe(200)
  })
})

describe('deleteChatwootWebhook (best-effort)', () => {
  it('issues a DELETE to the webhook id', async () => {
    responder = () => emptyResponse(200)
    await deleteChatwootWebhook('https://cw.example.com', 'tok', 7, 55)
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/webhooks/55'
    )
  })

  it('swallows errors instead of throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    responder = () => new Response('err', { status: 500, statusText: 'err' })
    await expect(
      deleteChatwootWebhook('https://cw.example.com', 'tok', 7, 55)
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })
})

describe('sendChatwootMessage', () => {
  it('POSTs an outgoing message to the conversation', async () => {
    responder = () => jsonResponse({ id: 321 })
    const res = await sendChatwootMessage(
      'https://cw.example.com',
      'tok',
      7,
      88,
      'hello world'
    )
    expect(res).toEqual({ id: 321 })
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/conversations/88/messages'
    )
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual({
      content: 'hello world',
      message_type: 'outgoing'
    })
  })
})

describe('createChatwootAgentBot', () => {
  it('creates the bot without an outgoing url (single call)', async () => {
    responder = () => jsonResponse({ id: 5, name: 'Bot', access_token: 'abc' })
    const bot = await createChatwootAgentBot(
      'https://cw.example.com',
      'tok',
      7,
      {
        name: 'Bot'
      }
    )
    expect(bot).toEqual({ id: 5, name: 'Bot', access_token: 'abc' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual({
      name: 'Bot',
      description: 'AI agent powered by Vibesboard'
    })
  })

  it('PATCHes the outgoing url after creation when provided', async () => {
    let n = 0
    responder = () => {
      n += 1
      if (n === 1)
        return jsonResponse({ id: 9, name: 'Bot', access_token: 'tk' })
      return jsonResponse({
        id: 9,
        name: 'Bot',
        access_token: 'tk',
        outgoing_url: 'https://app/out'
      })
    }
    const bot = await createChatwootAgentBot(
      'https://cw.example.com',
      'tok',
      7,
      {
        name: 'Bot',
        description: 'custom',
        outgoingUrl: 'https://app/out'
      }
    )
    expect(bot.outgoing_url).toBe('https://app/out')
    expect(calls).toHaveLength(2)
    expect(calls[0]!.body).toEqual({ name: 'Bot', description: 'custom' })
    expect(calls[1]!.method).toBe('PATCH')
    expect(calls[1]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/agent_bots/9'
    )
    expect(calls[1]!.body).toEqual({ outgoing_url: 'https://app/out' })
  })
})

describe('deleteChatwootAgentBot (best-effort)', () => {
  it('DELETEs the bot by id', async () => {
    responder = () => emptyResponse(200)
    await deleteChatwootAgentBot('https://cw.example.com', 'tok', 7, 12)
    expect(calls[0]!.method).toBe('DELETE')
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/agent_bots/12'
    )
  })

  it('swallows errors instead of throwing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    responder = () => new Response('x', { status: 500, statusText: 'x' })
    await expect(
      deleteChatwootAgentBot('https://cw.example.com', 'tok', 7, 12)
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })
})

describe('agent bot inbox assignment', () => {
  it('assignAgentBotToInbox posts the bot id', async () => {
    responder = () => emptyResponse(200)
    await assignAgentBotToInbox('https://cw.example.com', 'tok', 7, 3, 9)
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/inboxes/3/set_agent_bot'
    )
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.body).toEqual({ agent_bot: 9 })
  })

  it('unassignAgentBotFromInbox posts a null bot and swallows errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    responder = () => emptyResponse(200)
    await unassignAgentBotFromInbox('https://cw.example.com', 'tok', 7, 3)
    expect(calls[0]!.body).toEqual({ agent_bot: null })

    calls = []
    responder = () => new Response('x', { status: 500, statusText: 'x' })
    await expect(
      unassignAgentBotFromInbox('https://cw.example.com', 'tok', 7, 3)
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
  })
})

describe('conversation status toggles', () => {
  it('handoffChatwootConversation toggles status to open', async () => {
    responder = () => emptyResponse(200)
    await handoffChatwootConversation('https://cw.example.com', 'tok', 7, 44)
    expect(calls[0]!.url).toBe(
      'https://cw.example.com/api/v1/accounts/7/conversations/44/toggle_status'
    )
    expect(calls[0]!.body).toEqual({ status: 'open' })
  })

  it('resumeChatwootConversation toggles status to pending', async () => {
    responder = () => emptyResponse(200)
    await resumeChatwootConversation('https://cw.example.com', 'tok', 7, 44)
    expect(calls[0]!.body).toEqual({ status: 'pending' })
  })

  it('handoffChatwootConversation propagates non-ok errors', async () => {
    responder = () =>
      new Response('boom', { status: 422, statusText: 'Unprocessable' })
    await expect(
      handoffChatwootConversation('https://cw.example.com', 'tok', 7, 44)
    ).rejects.toThrow(/Chatwoot API error 422: boom/)
  })
})
