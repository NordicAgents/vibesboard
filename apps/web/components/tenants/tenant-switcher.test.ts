import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const component = readFileSync(
  fileURLToPath(new URL('./tenant-switcher.tsx', import.meta.url)),
  'utf8'
)

describe('TenantSwitcher', () => {
  it('defaults only an unset active workspace to the personal workspace', () => {
    expect(component).toMatch(
      /const defaultTenant = currentTenantId\s*\?\s*null\s*:\s*\(tenants\.find\(tenant => tenant\.isPersonal\)/
    )
    expect(component).toContain('void handleTenantSwitch(defaultTenant.id)')
    expect(component).toContain('currentTenantId ||')
  })
})
