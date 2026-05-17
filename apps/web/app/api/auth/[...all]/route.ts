import { auth } from '@vibesboard/adapter-better-auth'
import { toNextJsHandler } from 'better-auth/next-js'

export const { GET, POST } = toNextJsHandler(auth.handler)
