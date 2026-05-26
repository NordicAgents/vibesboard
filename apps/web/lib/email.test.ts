import { test, describe } from 'node:test'
import assert from 'node:assert'

import { maskEmail } from './email.ts'

describe('maskEmail', () => {
  test('masks a standard email', () => {
    assert.strictEqual(maskEmail('john@example.com'), 'j***@e***.com')
  })

  test('masks short local/domain parts', () => {
    assert.strictEqual(maskEmail('a@b.co'), 'a***@b***.co')
  })

  test('returns placeholder for invalid input', () => {
    assert.strictEqual(maskEmail('not-an-email'), '***')
    assert.strictEqual(maskEmail(''), '***')
    assert.strictEqual(maskEmail(null), '***')
    assert.strictEqual(maskEmail(undefined), '***')
  })
})
