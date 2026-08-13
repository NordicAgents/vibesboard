import { describe, expect, it } from 'vitest'

import { upsertAgentSchema } from './schema.ts'

describe('upsertAgentSchema public access default', () => {
  it('keeps newly created agents private unless public access is explicit', () => {
    const parsed = upsertAgentSchema.parse({
      name: 'Support agent',
      instructions: 'Answer customer support questions accurately.'
    })

    expect(parsed.allowAnonymous).toBe(false)
  })
})
