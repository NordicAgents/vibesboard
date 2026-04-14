import test from 'node:test'
import assert from 'node:assert/strict'

import { getSafeRedirectPath } from './redirects.ts'

test('getSafeRedirectPath', () => {
  assert.equal(getSafeRedirectPath('/invite/abc'), '/invite/abc')
  assert.equal(getSafeRedirectPath('/agents/new?x=1'), '/agents/new?x=1')

  assert.equal(getSafeRedirectPath(null), null)
  assert.equal(getSafeRedirectPath(''), null)
  assert.equal(getSafeRedirectPath('   '), null)
  assert.equal(getSafeRedirectPath('http://evil.com'), null)
  assert.equal(getSafeRedirectPath('https://evil.com'), null)
  assert.equal(getSafeRedirectPath('//evil.com'), null)
  assert.equal(getSafeRedirectPath('javascript:alert(1)'), null)
  assert.equal(getSafeRedirectPath('/path\nnext'), null)
  assert.equal(getSafeRedirectPath('/path\rnext'), null)
  assert.equal(getSafeRedirectPath('/\\\\evil.com'), null)
})
