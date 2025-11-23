import { cookies } from 'next/headers'
import { Configuration, OpenAIApi } from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'

import { auth } from '@/auth'

export const runtime = 'edge'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

export async function POST(req: Request) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const json = await req.json()
  const { messages, previewToken } = json

  if (previewToken) {
    configuration.apiKey = previewToken
  }

  const res = await openai.createChatCompletion({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a concise agent designer. Rewrite user ideas into high quality agent instructions.'
      },
      ...messages
    ],
    temperature: 0.3,
    stream: true
  })

  const stream = OpenAIStream(res)
  return new StreamingTextResponse(stream)
}
