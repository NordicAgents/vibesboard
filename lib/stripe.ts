import 'server-only'
import Stripe from 'stripe'

let _stripe: Stripe | null = null

/**
 * Lazy-initialized Stripe client.
 * Avoids build-time errors when STRIPE_SECRET_KEY is not set.
 */
export function getStripeServer(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2026-03-25.dahlia',
      typescript: true,
    })
  }
  return _stripe
}

/**
 * Stripe client singleton — use this in route handlers.
 * Lazily initialized on first access.
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(getStripeServer(), prop, receiver)
  },
})
