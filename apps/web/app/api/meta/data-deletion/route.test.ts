import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createDeletionRequest = vi.fn(async () => undefined)
const updateDeletionRequest = vi.fn(async () => undefined)
const deleteInstagramDataForMetaUser = vi.fn()

vi.mock('@vibesboard/channel-instagram/data-deletion', () => ({
  createDeletionRequest,
  updateDeletionRequest,
  deleteInstagramDataForMetaUser
}))

const { POST } = await import('./route.ts')

const appSecret = crypto.randomBytes(32).toString('hex')

function signedRequest(userId = 'meta-user-123') {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      user_id: userId,
      issued_at: Math.floor(Date.now() / 1000)
    })
  ).toString('base64url')
  const signature = crypto
    .createHmac('sha256', appSecret)
    .update(encodedPayload)
    .digest('base64url')
  return `${signature}.${encodedPayload}`
}

function request() {
  return new NextRequest('https://attacker.invalid/api/meta/data-deletion', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      host: 'attacker.invalid'
    },
    body: new URLSearchParams({ signed_request: signedRequest() })
  })
}

describe('Meta data deletion callback', () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = appSecret
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    createDeletionRequest.mockClear()
    updateDeletionRequest.mockClear()
    deleteInstagramDataForMetaUser.mockReset()
  })

  afterEach(() => {
    delete process.env.META_APP_SECRET
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('does not return until deletion and status persistence complete', async () => {
    let finishDeletion!: (count: number) => void
    deleteInstagramDataForMetaUser.mockReturnValue(
      new Promise<number>(resolve => {
        finishDeletion = resolve
      })
    )

    let responseSettled = false
    const responsePromise = POST(request()).then(response => {
      responseSettled = true
      return response
    })

    await vi.waitFor(() => {
      expect(deleteInstagramDataForMetaUser).toHaveBeenCalledOnce()
    })
    expect(responseSettled).toBe(false)

    finishDeletion(2)
    const response = await responsePromise
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(updateDeletionRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'completed', deletedAccounts: 2 })
    )
    expect(body.url).toMatch(
      /^https:\/\/app\.example\.com\/deletion-status\?id=/
    )
    expect(body.url).not.toContain('attacker.invalid')
  })
})
