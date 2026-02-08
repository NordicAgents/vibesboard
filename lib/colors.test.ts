import test from 'node:test'
import assert from 'node:assert/strict'

import { hexToHslParts, normalizeHex, toCssHslVar } from './colors.ts'

test('normalizeHex', () => {
  assert.equal(normalizeHex('#abc'), '#aabbcc')
  assert.equal(normalizeHex('ABC'), '#aabbcc')
  assert.equal(normalizeHex('#AABBCC'), '#aabbcc')
  assert.equal(normalizeHex(''), null)
  assert.equal(normalizeHex('not-a-color'), null)
  assert.equal(normalizeHex('#abcd'), null)
})

test('hexToHslParts', () => {
  assert.deepEqual(hexToHslParts('#000000'), { h: 0, s: 0, l: 0 })
  assert.deepEqual(hexToHslParts('#ffffff'), { h: 0, s: 0, l: 100 })
  assert.deepEqual(hexToHslParts('#ff0000'), { h: 0, s: 100, l: 50 })
})

test('toCssHslVar', () => {
  assert.equal(toCssHslVar({ h: 0, s: 100, l: 50 }), '0 100% 50%')
  assert.equal(toCssHslVar({ h: 240, s: 5.9, l: 10 }), '240 5.9% 10%')
})
