// scripts/migrate-actions.ts
/**
 * One-time migration: convert old schedulingConfig/bookingConfig/dataConfig
 * fields to the new agent.actions[] array.
 *
 * Run: npx tsx scripts/migrate-actions.ts [--dry-run]
 *
 * Safe to run multiple times — skips agents that already have actions[].
 */
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import type { AgentAction } from '@/lib/types'

const DRY_RUN = process.argv.includes('--dry-run')

function generateId(): string {
  return adminDb.collection('_').doc().id
}

async function main() {
  console.log(`Migration mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const tenantsSnap = await adminDb.collection('tenants').get()
  let migrated = 0
  let skipped = 0

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id
    const agentsSnap = await adminDb.collection(Collections.agents(tenantId)).get()

    for (const agentDoc of agentsSnap.docs) {
      const agent = agentDoc.data()

      // Skip if already migrated
      if (agent.actions && Array.isArray(agent.actions) && agent.actions.length > 0) {
        skipped++
        continue
      }

      const actions: AgentAction[] = []

      // Migrate schedulingConfig → appointments action
      if (agent.schedulingConfig?.enabled) {
        const sc = agent.schedulingConfig
        actions.push({
          id: generateId(),
          type: 'appointments',
          enabled: true,
          connectionId: sc.calendarConnectionId ?? null,
          config: {
            timezone: sc.timezone ?? 'UTC',
            availableHours: sc.availableHours ?? { start: '09:00', end: '17:00' },
            availableDays: sc.availableDays ?? [1, 2, 3, 4, 5],
            defaultDurationMinutes: sc.defaultDurationMinutes ?? 30,
            bufferMinutes: sc.bufferMinutes ?? 0,
            meetingTitleTemplate: sc.meetingTitleTemplate ?? 'Meeting with {{name}}',
            meetingDescription: sc.meetingDescription,
            createMeetLink: sc.createMeetLink ?? false
          }
        })
      }

      // Migrate bookingConfig → booking action
      if (agent.bookingConfig?.enabled) {
        const bc = agent.bookingConfig
        actions.push({
          id: generateId(),
          type: 'booking',
          enabled: true,
          config: {
            mode: bc.mode ?? 'enquiry',
            resources: bc.resources ?? [],
            eventTitleTemplate: bc.eventTitleTemplate ?? '{guest_name} ({guest_count} guests)',
            eventTimeMode: bc.eventTimeMode ?? 'all-day',
            overlapProtection: bc.overlapProtection !== false
          }
        })
      } else if (agent.calendarAvailabilityConfig?.enabled) {
        // Legacy: calendarAvailabilityConfig → booking action with single resource
        const ca = agent.calendarAvailabilityConfig
        actions.push({
          id: generateId(),
          type: 'booking',
          enabled: true,
          config: {
            mode: 'enquiry',
            resources: [{
              id: generateId(),
              name: ca.resourceName ?? 'Resource',
              calendarConnectionId: ca.calendarConnectionId ?? '',
              calendarId: ca.calendarId ?? '',
              calendarName: ca.resourceName ?? 'Calendar',
              timezone: 'UTC'
            }],
            eventTitleTemplate: '{guest_name} ({guest_count} guests)',
            eventTimeMode: 'all-day',
            overlapProtection: true
          }
        })
      }

      // Migrate dataConfig → data action
      if (agent.dataConfig?.enabled) {
        const dc = agent.dataConfig
        actions.push({
          id: generateId(),
          type: 'data',
          enabled: true,
          connectionId: dc.dataConnectionId ?? null,
          config: {
            fieldMappings: dc.fieldMappings ?? [],
            updateKeyField: dc.updateKeyField ?? null,
            allowQuery: false,
            allowDelete: false,
            autoSubmitOnComplete: dc.autoSubmitOnComplete ?? false
          }
        })
      }

      if (actions.length === 0) {
        skipped++
        continue
      }

      console.log(`  ${tenantId}/${agentDoc.id}: ${actions.map(a => a.type).join(', ')}`)

      if (!DRY_RUN) {
        await agentDoc.ref.update({ actions })
      }

      migrated++
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`)
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
