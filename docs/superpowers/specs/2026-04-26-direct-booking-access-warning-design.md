# Direct Booking Access Warning Design

## Context

Simple Booking already supports two modes:

- `enquiry`: the agent checks availability, collects guest details, and creates an enquiry for admin review.
- `direct`: the agent can list, create, update, and cancel Google Calendar events without admin approval.

The backend direct-booking tools already exist and are injected when `bookingConfig.mode === 'direct'`. The product gap is mostly UX clarity and safety: direct mode can modify real calendars, but an agent may still have anonymous public chat enabled.

## Goal

Make the existing `enquiry` / `direct` mode behavior clear in the Actions tab and warn admins when direct mode is enabled while anonymous chat is still allowed.

This should protect owners from accidentally exposing calendar-management tools to anyone with the public agent link, while still allowing intentional public self-booking if the owner chooses to keep anonymous chat enabled.

## Non-Goals

- Do not add separate toggles for `list_bookings`, `create_booking`, `update_booking`, or `cancel_booking`.
- Do not change the existing direct-booking backend tool behavior.
- Do not block saving direct mode when anonymous chat is enabled.
- Do not redesign the Setup tab or password manager.
- Do not add role-based permissions inside public chat in this change.

## UX Design

The Simple Booking settings keep the existing mode selector, with clearer option labels:

- `Enquiry - guests submit requests for admin review`
- `Direct - agent writes calendar events immediately`

When Simple Booking is enabled, mode is `direct`, and `allowAnonymous` is true, show a prominent warning inside the Booking Mode card.

Warning copy:

> Direct booking can create, edit, list, and cancel calendar events. Anonymous chat is currently enabled, so anyone with the agent link may be able to manage bookings. Turn off anonymous chat in Setup and set an access password before using Direct mode.

The warning includes a `Go to Setup` action that switches the dashboard tab to Setup. The Setup tab already contains the `Allow anonymous chat` switch and shows the access password manager after anonymous chat is disabled.

## Component Changes

### `AgentBookingResourceConfig`

Add props:

```ts
allowAnonymous: boolean
onGoToSetup?: () => void
```

Render the direct-mode warning when:

```ts
current.enabled && current.mode === 'direct' && allowAnonymous
```

The component remains responsible only for displaying the warning and invoking `onGoToSetup`. It does not mutate anonymous access directly.

### `AgentActionsFlow`

Accept and pass through:

```ts
allowAnonymous: boolean
onGoToSetup?: () => void
```

### `AgentDashboardTabs`

Pass `fields.allowAnonymous` into `AgentActionsFlow`.

Implement `onGoToSetup` by switching the active tab to `setup`, using the existing tab state.

## Data Model

No Firestore schema changes are required.

The existing fields are enough:

- `bookingConfig.enabled`
- `bookingConfig.mode`
- `allowAnonymous`
- `accessPassword`

The warning intentionally depends only on `allowAnonymous`, because password protection only applies after anonymous chat is disabled in the current public-agent routing.

## Runtime Behavior

No runtime behavior changes are required.

The existing behavior remains:

- `enquiry` mode exposes availability checking and enquiry creation.
- `direct` mode exposes availability checking plus calendar event CRUD tools.

The warning is administrative UX only. It does not alter tool injection, calendar writes, or public chat access enforcement.

## Error Handling

If `onGoToSetup` is not provided, the warning still renders without the navigation button. This keeps the booking component reusable in contexts that do not have dashboard tab state.

If an agent is already protected with anonymous chat disabled, no direct-mode warning appears.

## Testing

Add or update focused tests where practical:

- Booking settings renders no warning in enquiry mode.
- Booking settings renders no warning in direct mode when anonymous chat is disabled.
- Booking settings renders the warning in direct mode when anonymous chat is enabled.
- If dashboard tab behavior is easy to test in the existing setup, verify the warning button switches to the Setup tab.

Manual verification:

1. Open an agent with Simple Booking enabled.
2. Set mode to Direct.
3. Keep Allow anonymous chat enabled.
4. Confirm the warning appears in Actions -> Simple Booking.
5. Click Go to Setup.
6. Confirm the Setup tab opens and shows the anonymous chat switch.
7. Turn anonymous chat off and save.
8. Return to Actions and confirm the warning disappears.

## Rollout Notes

This is a low-risk UI safety improvement. Existing agents in direct mode remain functional. Admins will see the warning only when the current configuration is potentially public.
