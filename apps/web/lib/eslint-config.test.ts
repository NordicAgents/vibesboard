import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const cwd = fileURLToPath(new URL('../', import.meta.url))

describe('ESLint 10 configuration', () => {
  const eslint = new ESLint({ cwd })

  it('uses the upgraded ESLint major', () => {
    expect(Number(ESLint.version.split('.')[0])).toBeGreaterThanOrEqual(10)
  })

  it.each(['js', 'mjs', 'jsx', 'ts', 'tsx'])(
    'lints a .%s module without parser or plugin failures',
    async extension => {
      const source = extension.endsWith('x')
        ? 'export const Card = () => <div />\n'
        : 'export const value = 1\n'
      const [result] = await eslint.lintText(source, {
        filePath: `lib/eslint-upgrade-fixture.${extension}`
      })
      expect(result.messages).toEqual([])
    }
  )

  it('still enforces React, React Hooks and Tailwind rules', async () => {
    const [result] = await eslint.lintText(
      `import { useState } from 'react'
       export function Card({ active }: { active: boolean }) {
         if (active) useState(0)
         return <div className="h-4 w-4">{[1].map(value => <span>{value}</span>)}</div>
       }`,
      { filePath: 'lib/eslint-upgrade-fixture.tsx' }
    )
    expect(result.fatalErrorCount).toBe(0)
    expect(result.messages.map(message => message.ruleId)).toEqual(
      expect.arrayContaining([
        'react/jsx-key',
        'react-hooks/rules-of-hooks',
        'tailwindcss/enforces-shorthand'
      ])
    )
    expect(result.errorCount).toBeGreaterThanOrEqual(2)
    expect(result.warningCount).toBeGreaterThanOrEqual(1)
  })
})
