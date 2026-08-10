/**
 * Tests for AI SDK v3 type compatibility and import surface.
 * No external dependencies — just verifies the SDK export surface resolves.
 */
import { describe, it, expect } from 'vitest'

describe('Message type re-export', () => {
  it('ai module imports without error', async () => {
    const ai = await import('ai')
    expect(ai).toBeTruthy()
  })

  it('ai/react module imports without error', async () => {
    const aiReact = await import('@ai-sdk/react')
    expect(aiReact).toBeTruthy()
  })
})

describe('AI SDK v3 export surface', () => {
  it('streamText is a function export from "ai"', async () => {
    const ai = await import('ai')
    expect(typeof ai.streamText).toBe('function')
  })

  it('tool is a function export from "ai"', async () => {
    const ai = await import('ai')
    expect(typeof ai.tool).toBe('function')
  })

  it('generateText is a function export from "ai"', async () => {
    const ai = await import('ai')
    expect(typeof ai.generateText).toBe('function')
  })

  it('createOpenAI is a function export from "@ai-sdk/openai"', async () => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    expect(typeof createOpenAI).toBe('function')
  })

  it('useChat is a function export from "ai/react"', async () => {
    const { useChat } = await import('@ai-sdk/react')
    expect(typeof useChat).toBe('function')
  })

  it('useCompletion is a function export from "ai/react"', async () => {
    const { useCompletion } = await import('@ai-sdk/react')
    expect(typeof useCompletion).toBe('function')
  })
})

describe('v2 backward-compat aliases', () => {
  it('experimental_streamText, if present, aliases streamText', async () => {
    const ai = await import('ai')
    if ((ai as any).experimental_streamText) {
      expect((ai as any).experimental_streamText).toBe(ai.streamText)
    }
  })

  it('experimental_generateText, if present, aliases generateText', async () => {
    const ai = await import('ai')
    if ((ai as any).experimental_generateText) {
      expect((ai as any).experimental_generateText).toBe(ai.generateText)
    }
  })
})
