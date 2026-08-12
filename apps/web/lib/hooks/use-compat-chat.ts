/**
 * Compatibility shim: maps the ai@7.x `useChat` interface back to the ai@4.x interface.
 *
 * ai@7.x removed `api`, `body`, `streamProtocol`, `initialMessages`, `input`,
 * `setInput`, `append`, `reload`, and `isLoading` from `useChat`. The transport
 * layer now uses a structured `prepareSendMessagesRequest` approach.
 *
 * This hook restores the old options so existing components work without change.
 */

'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, TextStreamChatTransport } from 'ai'
import type { UIMessage } from 'ai'

 
type AnyRecord = Record<string, any>

interface CompatChatOptions {
  /** Chat id (stable) */
  id?: string
  /** API endpoint (default: '/api/chat') */
  api?: string
  /** Stream protocol — 'text' uses TextStreamChatTransport, 'data' uses DefaultChatTransport */
  streamProtocol?: 'text' | 'data'
  /** Extra body fields forwarded to the API */
  body?: AnyRecord
  /** Initial messages in legacy Message format (id, role, content) */
   
  initialMessages?: any[]
  /** Called when the API response arrives — receives the raw Response for header inspection */
  onResponse?: (response: Response) => void
  /** Called when a message stream finishes — receives message-like object with content: string */
   
  onFinish?: (message: any) => void
  /** Called on error */
  onError?: (error: Error) => void
}

/** Extract plain text content from a UIMessage (ai@7.x) or legacy Message (has content) */
 
function extractContent(m: any): string {
  if (typeof m?.content === 'string') return m.content
  if (Array.isArray(m?.parts)) {
    return m.parts
      .filter((p: AnyRecord) => p.type === 'text')
      .map((p: AnyRecord) => p.text ?? '')
      .join('')
  }
  return ''
}

// Convert legacy Message[] → UIMessage[] so the SDK can accept initialMessages
 
function toUIMessages(msgs: any[] | undefined): UIMessage[] | undefined {
  if (!msgs?.length) return undefined
  return msgs.map(m => ({
    id: m.id,
    role: m.role,
    parts: [{ type: 'text' as const, text: extractContent(m) }],
  }))
}

export function useCompatChat(options: CompatChatOptions = {}) {
  const {
    id,
    api = '/api/chat',
    streamProtocol = 'data',
    body,
    initialMessages,
    onResponse,
    onFinish,
    onError,
  } = options

  // Manage input state ourselves (removed from useChat in ai@7.x)
  const [input, setInput] = useState('')

  // Keep mutable refs so transport closures always see the latest values
  const onResponseRef = useRef(onResponse)
  onResponseRef.current = onResponse
  const bodyRef = useRef(body)
  bodyRef.current = body

  // Build transport once per api+streamProtocol change.
  // Body and onResponse are read via refs so we don't need to rebuild.
  const transport = useMemo(() => {
    const transportOptions = {
      api,
      // Transform UIMessage[] → legacy Message[] format expected by our server routes.
      // ai@7.x sends UIMessage (with parts) by default; our server expects { messages: [{ role, content }] }.
       
      prepareSendMessagesRequest: async (opts: any) => {
        const legacyMessages = (opts.messages as UIMessage[]).map(m => ({
          id: m.id,
          role: m.role,
          content: extractContent(m),
        }))
        return {
          body: {
            ...(bodyRef.current ?? {}),
            ...opts.body,
            messages: legacyMessages,
          },
        }
      },
      // Intercept response for the onResponse callback (header reading).
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        const response = await globalThis.fetch(url, init)
        if (onResponseRef.current) {
          onResponseRef.current(response.clone())
        }
        return response
      },
    }
    if (streamProtocol === 'text') {
      return new TextStreamChatTransport(transportOptions)
    }
    return new DefaultChatTransport(transportOptions)
     
  }, [api, streamProtocol])

  const uiInitialMessages = useMemo(
    () => toUIMessages(initialMessages),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // only convert once — initialMessages are the initial state, not reactive
  )

  const {
    messages: rawUIMessages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
     
  } = (useChat as any)({
    id,
    messages: uiInitialMessages,
    transport,
    onFinish: onFinish
      ? (args: AnyRecord) => {
          // ai@7.x onFinish receives { message, messages, ... }
          const msg = args?.message ?? args
          onFinish({ ...msg, content: extractContent(msg) })
        }
      : undefined,
    onError,
  })

  // Normalize rawUIMessages to legacy Message format (with content: string)
   
  const messages = useMemo(
    () =>
      (rawUIMessages ?? []).map((m: any) => ({
        ...m,
        content: extractContent(m),
      })),
    [rawUIMessages]
  )

  // isLoading = true while the model is responding
  const isLoading = status === 'streaming' || status === 'submitted'

  // append: legacy API — takes { id, role, content } and sends it
  const append = useCallback(
     
    async (message: any, _opts?: any) => {
      const text = typeof message === 'string' ? message : extractContent(message)
      return sendMessage?.({ text })
    },
    [sendMessage]
  )

  // reload: regenerate last message
  const reload = useCallback(() => regenerate?.(), [regenerate])

  return {
    messages,
    input,
    setInput,
    append,
    reload,
    stop,
    isLoading,
    error,
    setMessages,
    status,
  }
}
