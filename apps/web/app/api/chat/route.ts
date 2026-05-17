import 'server-only'
import { streamText as aiStreamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'
import { OPENAI_CHAT_MODEL, isResponsesModel, streamText } from '@/lib/openai'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const json = await req.json()
  const { messages, previewToken } = json
  const session = await auth()
  const userId = session?.user?.id

  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const model = OPENAI_CHAT_MODEL
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response('OPENAI_API_KEY is not configured.', { status: 500 })
  }

  const saveChat = async (completion: string) => {
    const title = json.messages[0].content.substring(0, 100)
    const id = json.id ?? nanoid()
    const createdAt = Date.now()
    const path = `/chat/${id}`
    const payload = {
      id,
      title,
      userId,
      createdAt,
      path,
      messages: [...messages, { content: completion, role: 'assistant' }]
    }
    await adminDb
      .collection(Collections.chats)
      .doc(id)
      .set({ id, userId, payload }, { merge: true })
  }

  if (isResponsesModel(model)) {
    const conversation = Array.isArray(messages)
      ? messages
          .map(
            (m: any) =>
              `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${typeof m.content === 'string' ? m.content : ''}`
          )
          .join('\n\n')
      : ''
    const prompt =
      (conversation || '').trim() ||
      'You are a helpful assistant. Answer the user succinctly.'
    const stream = await streamText({
      prompt,
      model,
      apiKey,
      async onDone(completion) {
        await saveChat(completion)
      }
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    })
  }

  const openaiClient = createOpenAI({ apiKey })
  const result = await aiStreamText({
    model: openaiClient(model),
    messages,
    temperature: 0.0,
    async onFinish({ text }) {
      await saveChat(text)
    }
  })

  return result.toTextStreamResponse()
}

const stringToStream = (value: string) => {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(value))
      controller.close()
    }
  })
}
