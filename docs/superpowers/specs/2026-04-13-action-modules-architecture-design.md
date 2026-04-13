# Action Modules Architecture

Redesign of the agent actions system from scattered config objects and duplicated code into a clean, extensible module registry.

## Problem

The current action system has 4 separate config objects (`schedulingConfig`, `bookingConfig`, `calendarAvailabilityConfig`, `dataConfig`), 3 different availability checkers hitting the same Google Calendar API, 3 separate feature flags, and a 187-line context-builder full of nested if/else. Adding a new action type requires touching types, feature flags, context-builder, and UI. Naming is confusing to users ("Scheduling" vs "Availability" vs "Booking").

## Core Action Types

Three core capabilities, with three future expansions planned:

**Core (this design):**
- **Appointments** — slot-based scheduling (doctors, lawyers, consultations)
- **Booking** — resource/range-based booking (properties, venues, equipment)
- **Data** — CRUD to Google Sheets, Airtable, or webhooks

**Future (architecture must support, not implemented now):**
- **Notifications** — outbound email/SMS/WhatsApp
- **Payments** — payment links and collection (Stripe/Razorpay)
- **Handoff** — escalation to human / ticket creation

A single agent can use multiple action types simultaneously (e.g., Booking + Data).

## Data Model

### Agent document

Replace `schedulingConfig`, `bookingConfig`, `calendarAvailabilityConfig`, and `dataConfig` with a single `actions` array:

```typescript
interface AgentAction {
  id: string                    // auto-generated unique ID
  type: 'appointments' | 'booking' | 'data'
  enabled: boolean
  connectionId?: string         // references tenant-level connection
  config: AppointmentsConfig | BookingConfig | DataConfig
}

// On the VibeAgent document
agent.actions: AgentAction[]
```

### Shared connections

Calendar and data connections are tenant-level, shared across actions:

```
tenants/{tenantId}/connections/{connectionId}
  type: 'google_calendar' | 'google_sheets' | 'airtable' | 'webhook'
  status: 'active' | 'expired'
  credentials: { ... }
```

One Google Calendar OAuth connects once; both Appointments and Booking reference it.

### Action-specific configs

```typescript
// Appointments — slot-based scheduling
interface AppointmentsConfig {
  calendarId: string
  timezone: string
  availableHours: { start: string; end: string }
  availableDays: number[]       // 0=Sun, 1=Mon, etc.
  defaultDurationMinutes: number
  bufferMinutes: number
  meetingTitleTemplate: string
  meetingDescription?: string
  createMeetLink: boolean
}

// Booking — resource/range-based
interface BookingConfig {
  mode: 'enquiry' | 'direct'
  resources: BookableResource[]
  eventTitleTemplate: string
  eventTimeMode: 'all-day' | 'timed'
  overlapProtection: boolean
}

// Data — CRUD to external stores
interface DataConfig {
  fieldMappings: FieldMapping[]
  updateKeyField?: string       // enables update_record
  allowQuery: boolean           // enables query_records
  allowDelete: boolean          // enables delete_record
}
```

## Action Module Interface

Each action type implements one interface:

```typescript
// lib/agent/actions/types.ts

interface ActionModule {
  type: string
  buildTools(ctx: ActionContext): Promise<RegisteredTool[]>
}

interface ActionContext {
  agent: VibeAgent
  action: AgentAction
  getConnection: (id: string) => Promise<Connection | null>
  getAccessToken: (connection: Connection) => Promise<string>
}
```

### Registry

```typescript
// lib/agent/actions/registry.ts

const ACTION_REGISTRY: Record<string, ActionModule> = {
  appointments: AppointmentsModule,
  booking: BookingModule,
  data: DataModule,
}
```

### Context-builder integration

The current 100+ lines of if/else injection becomes:

```typescript
for (const action of agent.actions) {
  if (!action.enabled) continue
  const module = ACTION_REGISTRY[action.type]
  if (!module) continue
  try {
    const tools = await module.buildTools({ agent, action, getConnection, getAccessToken })
    for (const tool of tools) {
      toolkit.functions.push(tool.function)
      toolkit.executors[tool.function.name] = tool.execute
    }
  } catch (err) {
    console.error(`Failed to inject ${action.type} tools:`, err)
  }
}
```

Feature flags move to the UI layer. If an action is in `agent.actions` and `enabled: true`, it runs.

## Tools Per Module

### Appointments (5 tools)

| Tool | Description |
|------|-------------|
| `check_availability` | Check available time slots for a date |
| `book_appointment` | Book a specific time slot |
| `reschedule_appointment` | Move an existing appointment |
| `cancel_appointment` | Cancel an existing appointment |
| `list_appointments` | List upcoming appointments |

Renamed from `book_meeting` etc. — "appointment" is the correct general term for doctors, lawyers, salons, consultations.

### Booking (5 tools)

| Tool | Description |
|------|-------------|
| `check_booking_availability` | Check if resource is free for date range |
| `list_bookings` | List bookings for a resource/date range |
| `create_booking` | Create booking (direct mode) or submit enquiry (enquiry mode) |
| `update_booking` | Update an existing booking |
| `cancel_booking` | Cancel/delete a booking |

Merges current simple-booking and direct-booking into one module. The `mode` config controls behavior — `create_booking` in enquiry mode submits an enquiry; in direct mode it writes to calendar.

### Data (4 tools)

| Tool | Description |
|------|-------------|
| `submit_data` | Append a new row/record |
| `update_record` | Update existing record by key field |
| `query_records` | Search/read records (new) |
| `delete_record` | Delete a record by key field (new) |

Conditional injection: `update_record` requires `updateKeyField`, `query_records` requires `allowQuery`, `delete_record` requires `allowDelete`. A simple lead-capture agent only gets `submit_data`.

### Shared calendar utility (internal)

```typescript
// lib/agent/actions/shared/calendar.ts
// Used by both Appointments and Booking — single implementation

checkFreeBusy(accessToken, calendarId, timeMin, timeMax): BusySlot[]
```

Replaces the current 3 separate freeBusy implementations.

## File Structure

```
lib/agent/actions/
  types.ts                    # ActionModule, ActionContext, AgentAction
  registry.ts                 # ACTION_REGISTRY map
  shared/
    calendar.ts               # Shared freeBusy, slot formatting
  appointments/
    index.ts                  # AppointmentsModule
    tools.ts                  # 5 tool builders
    types.ts                  # AppointmentsConfig
  booking/
    index.ts                  # BookingModule
    tools.ts                  # 5 tool builders
    types.ts                  # BookingConfig, BookableResource
  data/
    index.ts                  # DataModule
    tools.ts                  # 4 tool builders
    types.ts                  # DataConfig, FieldMapping
```

### Files deleted

- `lib/agent/tools/scheduling.ts` — replaced by `actions/appointments/`
- `lib/agent/tools/simple-booking.ts` — merged into `actions/booking/`
- `lib/agent/tools/direct-booking.ts` — merged into `actions/booking/`
- `lib/agent/tools/calendar-availability.ts` — replaced by `actions/shared/calendar.ts`
- `lib/agent/tools/data-actions.ts` — replaced by `actions/data/`

### Files simplified

- `lib/agent/context-builder.ts` — if/else injection becomes registry loop
- `lib/types.ts` — `ActionToolType` union removed
- `lib/feature-flags.ts` — 3 sub-flags collapse to `AGENT_ACTIONS`

## Migration

### Strategy

Dual-write during transition. Context-builder reads `agent.actions` if present, falls back to old config fields. Once all agents are migrated, remove old code paths.

### Migration script

```typescript
function migrateAgent(agent) {
  const actions: AgentAction[] = []

  if (agent.schedulingConfig?.enabled) {
    actions.push({
      id: generateId(),
      type: 'appointments',
      enabled: true,
      connectionId: agent.schedulingConfig.calendarConnectionId,
      config: { /* map fields from schedulingConfig */ }
    })
  }

  if (agent.bookingConfig?.enabled) {
    actions.push({
      id: generateId(),
      type: 'booking',
      enabled: true,
      config: { /* map fields from bookingConfig */ }
    })
  }

  if (agent.dataConfig?.enabled) {
    actions.push({
      id: generateId(),
      type: 'data',
      enabled: true,
      connectionId: agent.dataConfig.dataConnectionId,
      config: { /* map fields from dataConfig */ }
    })
  }

  // calendarAvailabilityConfig is legacy — skip if bookingConfig already exists,
  // otherwise migrate as a booking action with single resource

  // Write agent.actions, keep old fields during rollout
}
```

### Rollout steps

1. Deploy new action module code alongside old code
2. Context-builder: prefer `agent.actions`, fallback to old fields
3. Run migration script on all existing agents
4. UI switches to new `actions` array for editing
5. Remove old config fields, old tool files, old feature flags

## Testing

- Unit tests per module: each tool builder tested in isolation
- Integration test: agent with multiple actions gets correct combined toolkit
- Migration test: verify old configs map correctly to new `actions` array
- Regression: existing appointment/booking/data flows produce identical Claude tool schemas
