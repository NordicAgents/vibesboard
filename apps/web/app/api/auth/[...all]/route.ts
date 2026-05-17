import { auth } from '@vibesboard/adapter-better-auth'
import { toNextJsHandler } from 'better-auth/next-js'

// Defer handler creation to request time. The Better Auth handler is built
// from `auth.handler`, which is a Proxy-backed lazy getter; touching it at
// module load (as `toNextJsHandler(auth.handler)` at top level would) reads
// DATABASE_URL through the Postgres client and crashes `next build`'s page
// data collection. By calling toNextJsHandler lazily per request, env access
// only happens at runtime.
export const dynamic = 'force-dynamic'

let _handler: ReturnType<typeof toNextJsHandler> | undefined
function getHandler() {
  if (!_handler) _handler = toNextJsHandler(auth.handler)
  return _handler
}

export async function GET(req: Request) {
  return getHandler().GET(req)
}

export async function POST(req: Request) {
  return getHandler().POST(req)
}
