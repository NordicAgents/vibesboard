import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import {
  LANDING_QUICKSTART_HEADING,
  LANDING_QUICKSTART_SUBHEADING,
  LANDING_QUICKSTART_TABS
} from './landing-quickstart-copy.ts'

const README = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'README.md'),
  'utf8'
)

describe('landing quickstart copy', () => {
  it('offers a local and a self-host path', () => {
    expect(LANDING_QUICKSTART_TABS.map(tab => tab.id)).toEqual([
      'local',
      'docker'
    ])
  })

  it('runs the exact commands the README documents', () => {
    const local = LANDING_QUICKSTART_TABS.find(tab => tab.id === 'local')
    expect(local).toBeDefined()

    // Drift guard: if someone edits the README quickstart without touching the
    // landing page, this fails instead of shipping instructions that no longer
    // work.
    for (const line of local!.command.split('\n').filter(Boolean)) {
      expect(README, line).toContain(line)
    }
  })

  // The runner stage of the Dockerfile copies only the standalone Next output
  // and starts it with `node apps/web/server.js` — nothing migrates on boot. A
  // self-host path that skips this leaves every auth and data route hitting
  // tables that do not exist.
  it('creates the env file and migrates before starting the self-host image', () => {
    const docker = LANDING_QUICKSTART_TABS.find(tab => tab.id === 'docker')
    expect(docker).toBeDefined()

    const command = docker!.command
    expect(command).toMatch(/cp \.env\.example \.env/)
    expect(command).toMatch(/db:migrate/)
    // Migrations authenticate as the privileged role, not the request role.
    expect(command).toMatch(/DATABASE_MIGRATE_URL/)
    expect(command.indexOf('db:migrate')).toBeLessThan(
      command.indexOf('docker run')
    )
  })

  it('states the real runtime requirements', () => {
    expect(LANDING_QUICKSTART_SUBHEADING).toMatch(/Bun 1\.2\.18/)
    expect(LANDING_QUICKSTART_SUBHEADING).toMatch(/Node 22/)
    expect(LANDING_QUICKSTART_SUBHEADING).toMatch(/Docker/)
  })

  it('gives every path a caveat and a link into the docs', () => {
    for (const tab of LANDING_QUICKSTART_TABS) {
      expect(tab.note.length, tab.id).toBeGreaterThan(40)
      expect(tab.command.trim().length, tab.id).toBeGreaterThan(0)
      // Docs are served from this app at /docs, not linked out to GitHub.
      expect(tab.docHref, tab.id).toMatch(/^\/docs\//)
      expect(tab.docLabel.length, tab.id).toBeGreaterThan(0)
    }
  })

  it('keeps the heading about time-to-running, not about vibes', () => {
    expect(LANDING_QUICKSTART_HEADING).toMatch(/minutes/i)
    expect(LANDING_QUICKSTART_HEADING).not.toMatch(/vibe/i)
  })
})
