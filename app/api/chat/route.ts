import 'server-only'
import { OpenAIStream, StreamingTextResponse } from 'ai'
import { Configuration, OpenAIApi } from 'openai-edge'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { Database } from '@/lib/db_types'

import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'
import { OPENAI_CHAT_MODEL, isResponsesModel, streamText } from '@/lib/openai'

export const runtime = 'nodejs'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })
  const json = await req.json()
  const { messages, previewToken } = json
  const userId = (await auth({ cookieStore }))?.user.id

  if (!userId) {
    return new Response('Unauthorized', {
      status: 401
    })
  }

  if (previewToken) {
    configuration.apiKey = previewToken
  }

  const model = OPENAI_CHAT_MODEL
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null

  if (isResponsesModel(model)) {
    const conversation = Array.isArray(messages)
      ? messages
          .map(
            (m: any) =>
              `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${
                typeof m.content === 'string' ? m.content : ''
              }`
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
          messages: [
            ...messages,
            {
              content: completion,
              role: 'assistant'
            }
          ]
        }
        await supabase.from('chats').upsert({ id, payload }).throwOnError()
      }
    })

    return new StreamingTextResponse(stream)
  }

  const res = await openai.createChatCompletion({
    model,
    messages,
    temperature: 0.0,
    stream: true
  })

  const stream = OpenAIStream(res, {
    async onCompletion(completion) {
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
        messages: [
          ...messages,
          {
            content: completion,
            role: 'assistant'
          }
        ]
      }
      // Insert chat into database.
      await supabase.from('chats').upsert({ id, payload }).throwOnError()
    }
  })

  return new StreamingTextResponse(stream)
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
