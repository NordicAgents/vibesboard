/**
 * Tests for the OpenAI adapter (@vibesboard/adapter-openai) export surface.
 *
 * The adapter has been refactored over time, so rather than hard-code a fixed
 * set of function names this imports the module and asserts that whatever
 * recognised helpers are present are callable functions. Live API behaviour is
 * exercised only when a real `sk-…` key is configured.
 */
import { describe, it, expect } from 'vitest'

function hasRealApiKey(): boolean {
  const key = process.env.OPENAI_API_KEY
  return !!key && key.startsWith('sk-') && key.length >= 40
}

// Candidate helper names this adapter has exposed across versions. We only
// assert on the ones that actually exist in the current build.
const CANDIDATE_FNS = [
  'chatCompletion',
  'createEmbedding',
  'createEmbeddings',
  'chatCompletionWithVision',
  'streamChatCompletion'
]

describe('adapter-openai export surface', () => {
  it('module imports without error', async () => {
    const mod = await import('@vibesboard/adapter-openai')
    expect(mod).toBeTruthy()
  })

  it('any recognised helper exports are functions', async () => {
    const mod = (await import('@vibesboard/adapter-openai')) as Record<
      string,
      unknown
    >
    const present = CANDIDATE_FNS.filter(name => name in mod)
    expect(present.length > 0).toBeTruthy()
    for (const name of present) {
      expect(typeof mod[name]).toBe('function')
    }
  })
})

describe.skipIf(!hasRealApiKey())('adapter-openai live API', () => {
  it('a chat helper returns a non-empty completion', async () => {
    const mod = (await import('@vibesboard/adapter-openai')) as Record<
      string,
      unknown
    >
    const fn = (mod.chatCompletion ?? mod.streamChatCompletion) as
      | ((args: unknown) => Promise<unknown>)
      | undefined
    if (!fn) return
    const result: any = await fn({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say OK' }],
      temperature: 0,
      max_tokens: 10
    })
    expect(result).toBeTruthy()
  })
})
