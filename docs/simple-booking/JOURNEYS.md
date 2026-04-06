# Simple Booking — Journeys

Three actors interact with the simple booking feature: the **owner** who configures it,
the **guest** who uses it via chat, and the **agent** that orchestrates everything in between.

---

## Owner Journey

*The tenant admin who sets up the agent.*

1. **Connect Google Calendar** — Settings → Scheduling → add a Google Calendar OAuth connection.
2. **Configure booking** — Agent → Actions → Booking tab:
   - Add a resource: give it a name (e.g. "Glass Cabin"), pick the calendar connection, pick the calendar, set the IANA timezone (e.g. `Asia/Kolkata`).
   - Toggle **Enable simple booking** on.
3. **Save** — booking config persists on the agent document.
4. **Receive enquiries** — for each submission, an email arrives with:
   - Guest name, email, phone, guest count, notes.
   - Check-in → check-out displayed in the resource's local time.
   - `.ics` attachment — one click to add to calendar; the email body hints which Google Calendar to add it to.
5. **Track** — Agent → Enquiries tab shows all submitted requests, newest first.

---

## Guest Journey

*The person chatting with the agent.*

1. Opens the agent chat and asks: *"Is the cabin free from May 10–12?"*
2. Agent checks availability and responds with one of:
   - **Available** — "Yes, those dates are free — want to book?"
   - **Busy** — "Those dates are taken, but here are 3 nearby options: May 7–9, May 14–16, May 21–23."
3. Guest picks a slot and confirms dates.
4. Agent collects details — name, email, phone, guest count, any notes.
5. Agent submits the enquiry and confirms: *"Your enquiry is in — the owner will be in touch."*

---

## Agent Journey

*What the AI does internally — tool calls and logic.*

```
Guest: "Is the cabin free May 10–12?"
  └─ Tool: check_calendar_availability
       ├─ resolveResource("Glass Cabin")
       │    └─ looks up BookableResource by name → calendarConnectionId + calendarId
       ├─ getValidAccessToken(connection) → OAuth access token (refreshes if needed)
       ├─ Past date guard → rejects if requested start < today
       ├─ Google Calendar freeBusy API → busy intervals for the date range
       ├─ Available? → return confirmation
       └─ Busy? → findNearestSlots()
            ├─ scans forward from requested start
            ├─ scans backward from requested start
            └─ returns up to 3 options sorted by proximity

Guest: "Let's go with May 14–16, here are my details..."
  └─ Tool: submit_enquiry
       ├─ Validate required fields (name, email, phone)
       ├─ resolveResource() → confirms resource is still valid
       ├─ createEnquiry()
       │    └─ writes BookingEnquiryDocument to Firestore
       │         tenants/{tenantId}/agents/{agentId}/bookingEnquiries/{id}
       └─ notifyAdminOfEnquiry() [fire-and-forget]
            ├─ resolve admin email (notificationConfig.email → agent owner account)
            ├─ generateIcs()
            │    └─ DTSTART;TZID=Asia/Kolkata:20260514T140000  ← no UTC conversion
            └─ Resend → plain-text email + base64 .ics attachment
```

### Key design decisions

| Decision | Reason |
|---|---|
| `DTSTART;TZID=` format in ICS | Avoids server-timezone-dependent UTC conversion; wall-clock time is preserved exactly |
| Wall-clock datetimes stored as strings (no tz suffix) | Queried for display only — never need arithmetic, so no Date object needed |
| `notifyAdminOfEnquiry` is fire-and-forget | Email failure should not block the guest confirmation response |
| Simple-booking and calendar-availability are mutually exclusive | Both register `check_calendar_availability`; `if/else if` in context-builder prevents collision |
| Feature-gated behind `AGENT_ACTIONS_BOOKING` | Child of `AGENT_ACTIONS` — disabled at platform level until explicitly enabled per tenant |
