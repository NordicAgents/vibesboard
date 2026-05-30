import { describe, expect, it } from 'vitest'
import { cn, formatDate, nanoid, slugify } from './general.ts'

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('collapses runs of spaces/underscores/hyphens into a single hyphen', () => {
    expect(slugify('a   b___c---d')).toBe('a-b-c-d')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('  -Hello-  ')).toBe('hello')
  })

  it('removes punctuation that is not word/space/hyphen', () => {
    // The implementation strips [^\w\s-], so "!" etc. are removed entirely
    // (NOT turned into separators).
    expect(slugify('Hello, World!')).toBe('hello-world')
    expect(slugify('a.b.c')).toBe('abc')
  })

  it('preserves digits and treats underscore as a separator', () => {
    expect(slugify('Top 10 Things')).toBe('top-10-things')
    // Underscore is a word char, but the second pass collapses [\s_-]+ to '-'.
    expect(slugify('foo_bar')).toBe('foo-bar')
  })

  it('does NOT strip accents (\\w is ASCII-only here, so accented letters are removed)', () => {
    // This documents the real behavior: the regex [^\w\s-] removes accented
    // characters because \w does not match them. slugify is NOT diacritic-aware.
    expect(slugify('Crème Brûlée')).toBe('crme-brle')
    expect(slugify('café')).toBe('caf')
  })

  it('returns empty string for input with no word characters', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('   ')).toBe('')
    expect(slugify('')).toBe('')
  })

  it('drops emoji and other non-word symbols', () => {
    expect(slugify('hello 🎉 world')).toBe('hello-world')
  })

  it('is idempotent on an already-slugged value', () => {
    expect(slugify('already-a-slug')).toBe('already-a-slug')
  })
})

describe('cn', () => {
  it('joins multiple class strings', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b')
  })

  it('supports conditional object syntax', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active')
  })

  it('merges conflicting tailwind utilities, last one wins', () => {
    // twMerge dedupes conflicting classes in the same group.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('keeps non-conflicting tailwind utilities', () => {
    expect(cn('px-2', 'py-4')).toBe('px-2 py-4')
  })

  it('flattens arrays of classes', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c')
  })

  it('returns empty string for no args', () => {
    expect(cn()).toBe('')
  })
})

describe('nanoid', () => {
  it('generates a 7-character id', () => {
    expect(nanoid()).toHaveLength(7)
  })

  it('only uses the configured alphabet (alphanumerics)', () => {
    for (let i = 0; i < 50; i++) {
      expect(nanoid()).toMatch(/^[0-9A-Za-z]{7}$/)
    }
  })

  it('produces distinct values across many calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(nanoid())
    // Collisions in 1000 draws from 62^7 are astronomically unlikely.
    expect(ids.size).toBe(1000)
  })
})

describe('formatDate', () => {
  // formatDate compares the input against `new Date()` internally. Rather than
  // fight Vitest 4's fake-timer/Date semantics, we build inputs as offsets from
  // the REAL current time. Test execution is sub-millisecond, so the computed
  // "ago" diffs land deterministically inside each boundary bucket.
  const SEC = 1000
  const MIN = 60 * SEC
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR
  // Offset a little PAST each bucket start so sub-ms execution drift can never
  // push us back into the previous bucket.
  const ago = (ms: number) => new Date(Date.now() - ms)

  it('returns "Just now" for under a minute', () => {
    expect(formatDate(ago(30 * SEC))).toBe('Just now')
    expect(formatDate(ago(55 * SEC))).toBe('Just now')
  })

  it('returns singular "1 minute ago" just past one minute', () => {
    expect(formatDate(ago(MIN + 5 * SEC))).toBe('1 minute ago')
  })

  it('returns plural minutes', () => {
    expect(formatDate(ago(5 * MIN + SEC))).toBe('5 minutes ago')
    expect(formatDate(ago(58 * MIN))).toBe('58 minutes ago')
  })

  it('returns singular "1 hour ago" just past one hour', () => {
    expect(formatDate(ago(HOUR + MIN))).toBe('1 hour ago')
  })

  it('returns plural hours', () => {
    expect(formatDate(ago(3 * HOUR + MIN))).toBe('3 hours ago')
    expect(formatDate(ago(22 * HOUR))).toBe('22 hours ago')
  })

  it('returns "Yesterday" just past one day', () => {
    expect(formatDate(ago(DAY + HOUR))).toBe('Yesterday')
  })

  it('returns "N days ago" for 2-6 days', () => {
    expect(formatDate(ago(2 * DAY + HOUR))).toBe('2 days ago')
    expect(formatDate(ago(6 * DAY + HOUR))).toBe('6 days ago')
  })

  it('formats as a readable month/day date for 7+ days old, omitting the current year', () => {
    // For a same-year date, formatDate passes `year: undefined` which omits the
    // year, so the output is just month + day (e.g. "May 20"). We assert the
    // month/day appears and the current year does NOT.
    const tenDaysAgo = ago(10 * DAY)
    const monthDay = tenDaysAgo
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      // Drop any trailing year the renderer might append when year is included.
      .replace(/,? \d{4}$/, '')
    const result = formatDate(tenDaysAgo)
    expect(result).toContain(monthDay)
    expect(result).not.toContain(String(tenDaysAgo.getFullYear()))
  })

  it('includes the year for dates in a clearly different year', () => {
    const longAgo = new Date(Date.now() - 400 * DAY)
    const result = formatDate(longAgo)
    expect(result).toContain(String(longAgo.getFullYear()))
  })

  it('accepts a numeric timestamp', () => {
    expect(formatDate(ago(2 * MIN + SEC).getTime())).toBe('2 minutes ago')
  })

  it('accepts an ISO string', () => {
    expect(formatDate(ago(HOUR + MIN).toISOString())).toBe('1 hour ago')
  })

  it('accepts a Date instance', () => {
    expect(formatDate(ago(45 * SEC))).toBe('Just now')
  })
})
