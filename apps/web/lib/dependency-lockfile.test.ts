import { readFileSync } from 'node:fs'
import { parseConfigFileTextToJson } from 'typescript'
import { describe, expect, it } from 'vitest'

type Dependencies = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const repoRoot = new URL('../../../', import.meta.url)
const { config, error } = parseConfigFileTextToJson(
  'bun.lock',
  readFileSync(new URL('bun.lock', repoRoot), 'utf8')
)
const lockfile = config as { workspaces: Record<string, Dependencies> }

describe('dependency lockfile', () => {
  it('parses the Bun text lockfile', () => {
    expect(error).toBeUndefined()
  })

  // Dependabot manifest-only updates otherwise fail every frozen CI install
  // before TypeScript, unit tests, or Playwright can start.
  it.each(Object.keys(lockfile.workspaces))(
    'matches the dependency declarations for workspace %j',
    workspace => {
      const manifest = JSON.parse(
        readFileSync(
          new URL(`${workspace || '.'}/package.json`, repoRoot),
          'utf8'
        )
      ) as Dependencies

      for (const field of [
        'dependencies',
        'devDependencies',
        'optionalDependencies'
      ] as const) {
        expect(lockfile.workspaces[workspace][field] ?? {}).toEqual(
          manifest[field] ?? {}
        )
      }
    }
  )
})
