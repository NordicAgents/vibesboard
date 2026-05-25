CREATE UNIQUE INDEX "bookings_active_natural_key"
  ON "public"."bookings" ("agent_id", "start_time", "attendee_email")
  WHERE "status" IN ('confirmed', 'rescheduled');
