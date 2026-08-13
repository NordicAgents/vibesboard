CREATE TABLE "request_rate_limits" (
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "request_rate_limits_pk" ON "request_rate_limits" USING btree ("scope","key_hash","window_start");--> statement-breakpoint
CREATE INDEX "request_rate_limits_window_idx" ON "request_rate_limits" USING btree ("window_start");
--> statement-breakpoint
ALTER TABLE "request_rate_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "request_rate_limits_admin" ON "request_rate_limits"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
