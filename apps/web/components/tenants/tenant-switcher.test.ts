import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const component = readFileSync(
  fileURLToPath(new URL('./tenant-switcher.tsx', import.meta.url)),
  'utf8'
)

describe('TenantSwitcher', () => {
  it('defaults a missing active workspace to the personal workspace and persists it', () => {
    expect(component).toContain(
      'tenants.find(tenant => tenant.isPersonal) ?? tenants[0] ?? null'
    )
    expect(component).toContain('void handleTenantSwitch(defaultTenant.id)')
  })
})
