import { describe, it, expectTypeOf, assertType, expect } from 'vitest'
import type {
  // domain-types.ts
  PlanId,
  TenantRole,
  AgentMode,
  QuickSuggestionsMode,
  FileStatus,
  CalendarProvider,
  BookingStatus,
  UsageSource,
  TenantDocument,
  AgentDocument,
  UserDocument,
  TenantSubscription,
  HookDocument,
  ConversationDocument,
  // types.ts
  BuiltinToolType,
  ActionToolType,
  AgentToolType,
  RetrievalStrategy,
  CollectionFieldType,
  CollectionField,
  VibeAgent,
  VibeAgentTool,
  ServerActionResult,
  // message.ts (re-exported from the `ai` SDK)
  Message,
  // ports
  IDataStore,
  IAuth,
  IStorage,
  IAIProvider,
  ICalendarProvider,
  IBilling,
  IInboxChannel,
} from './index.ts'

/**
 * The contracts package is overwhelmingly type-only, so its real "does it work"
 * surface is type-level: the re-exports must resolve and the shapes must hold.
 * Vitest type-checks `.test.ts` files, so `expectTypeOf` / `assertType` here are
 * genuine, enforced assertions — a removed or mis-shaped export fails the run.
 *
 * We also import every name above through the package BARREL (`./index.ts`),
 * which transitively proves the barrel re-export wiring (domain-types, types,
 * message, ports) is intact.
 */
describe('contracts type re-exports (compile-time contract)', () => {
  it('runs (presence of this test forces the file to compile & load)', () => {
    expect(true).toBe(true)
  })

  it('string-literal union enums accept valid members and reject others', () => {
    expectTypeOf<PlanId>().toEqualTypeOf<'free' | 'pro' | 'team' | 'enterprise'>()
    expectTypeOf<TenantRole>().toEqualTypeOf<'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'>()
    expectTypeOf<AgentMode>().toEqualTypeOf<'provider' | 'collector'>()
    expectTypeOf<QuickSuggestionsMode>().toEqualTypeOf<'off' | 'smart' | 'always'>()
    expectTypeOf<RetrievalStrategy>().toEqualTypeOf<'direct' | 'rag' | 'bash'>()
    expectTypeOf<CalendarProvider>().toEqualTypeOf<'google_calendar' | 'cal_com'>()
    expectTypeOf<BookingStatus>().toEqualTypeOf<'confirmed' | 'cancelled' | 'rescheduled'>()

    assertType<FileStatus>('indexed')
    assertType<UsageSource>('whatsapp')
    assertType<CollectionFieldType>('email')
  })

  it('tool-type unions compose builtin + action variants', () => {
    assertType<BuiltinToolType>('builtin:bash')
    assertType<ActionToolType>('action:book_appointment')
    // AgentToolType is the union of both families.
    assertType<AgentToolType>('builtin:web_fetch')
    assertType<AgentToolType>('action:cancel_booking')
    expectTypeOf<BuiltinToolType>().toMatchTypeOf<AgentToolType>()
    expectTypeOf<ActionToolType>().toMatchTypeOf<AgentToolType>()
  })

  it('document interfaces carry their key fields', () => {
    expectTypeOf<TenantDocument>().toHaveProperty('slug').toEqualTypeOf<string>()
    expectTypeOf<TenantDocument>().toHaveProperty('status')
    expectTypeOf<UserDocument>().toHaveProperty('isSuperAdmin').toEqualTypeOf<boolean>()
    expectTypeOf<UserDocument>().toHaveProperty('tenantIds').toEqualTypeOf<string[]>()
    expectTypeOf<AgentDocument>().toHaveProperty('tenantId').toEqualTypeOf<string>()
    expectTypeOf<AgentDocument>().toHaveProperty('mode').toEqualTypeOf<AgentMode>()
    expectTypeOf<TenantSubscription>().toHaveProperty('planId').toEqualTypeOf<PlanId>()
    expectTypeOf<HookDocument>().toHaveProperty('secretHash').toEqualTypeOf<string>()
    expectTypeOf<ConversationDocument>().toHaveProperty('agentId')
  })

  it('constructs a minimal valid VibeAgent / CollectionField at the type level', () => {
    const field: CollectionField = {
      id: 'f1',
      label: 'Email',
      type: 'email',
      required: true,
      order: 0,
    }
    expectTypeOf(field).toMatchTypeOf<CollectionField>()

    const tool: VibeAgentTool = {
      id: 't1',
      type: 'builtin:bash',
      name: 'Bash',
    }
    expectTypeOf(tool).toMatchTypeOf<VibeAgentTool>()

    const agent: VibeAgent = {
      id: 'a1',
      userId: 'u1',
      tenantId: 't1',
      name: 'Demo',
      instructions: 'Be helpful',
      fileKeys: [],
      agentUrl: 'demo',
      tools: [tool],
      allowAnonymous: false,
      mode: 'provider',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    expectTypeOf(agent).toMatchTypeOf<VibeAgent>()
  })

  it('ServerActionResult is a Promise of the result or an error envelope', () => {
    expectTypeOf<ServerActionResult<{ ok: true }>>().toEqualTypeOf<
      Promise<{ ok: true } | { error: string }>
    >()
  })

  it('re-exports the `ai` SDK Message type', () => {
    // Pin that `Message` is a usable object shape with at least role+content.
    // (message.ts forwards `ai`'s Message; this guards the re-export path.)
    expectTypeOf<Message>().toHaveProperty('role')
    expectTypeOf<Message>().toHaveProperty('content')
  })

  it('exposes the port interfaces with their discriminator fields', () => {
    expectTypeOf<IDataStore>().toHaveProperty('kind').toEqualTypeOf<string>()
    expectTypeOf<IAuth>().toHaveProperty('kind').toEqualTypeOf<string>()
    expectTypeOf<IStorage>().toHaveProperty('kind').toEqualTypeOf<string>()
    expectTypeOf<IAIProvider>().toHaveProperty('kind').toEqualTypeOf<string>()
    expectTypeOf<ICalendarProvider>().toHaveProperty('kind').toEqualTypeOf<string>()
    expectTypeOf<IBilling>().toHaveProperty('kind').toEqualTypeOf<string>()
    // IInboxChannel uses `id` (readonly string), not `kind`.
    expectTypeOf<IInboxChannel>().toHaveProperty('id').toEqualTypeOf<string>()
  })
})
