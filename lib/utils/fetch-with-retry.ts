/**
 * Fetch with timeout and exponential backoff retry.
 *
 * Retries on transient failures: 429 (rate limit), 5xx (server errors),
 * and network errors. Does NOT retry on 4xx client errors.
 */

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number    // default 10_000
  maxAttempts?: number  // default 3
  baseDelayMs?: number  // default 500 — doubled each retry
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { timeoutMs = 10_000, maxAttempts = 3, baseDelayMs = 500, ...fetchOptions } = options

  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // Merge caller's signal with our timeout signal
    const signal = fetchOptions.signal
      ? anySignal([fetchOptions.signal, controller.signal])
      : controller.signal

    try {
      const res = await fetch(url, { ...fetchOptions, signal })
      clearTimeout(timer)

      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts - 1) {
        // Respect Retry-After header for 429
        const retryAfter = res.headers.get('Retry-After')
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : baseDelayMs * Math.pow(2, attempt)
        await sleep(delay)
        continue
      }

      return res
    } catch (err) {
      clearTimeout(timer)

      // AbortError from our timeout
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error(`Request timed out after ${timeoutMs}ms`)
      } else {
        lastError = err
      }

      // Retry on network errors, not on caller-aborted signals
      const callerAborted = fetchOptions.signal?.aborted
      if (callerAborted || attempt === maxAttempts - 1) {
        throw lastError
      }

      await sleep(baseDelayMs * Math.pow(2, attempt))
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Returns a signal that aborts when ANY of the given signals abort.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}
