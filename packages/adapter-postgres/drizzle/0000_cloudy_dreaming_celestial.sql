CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image_url" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"plan_id" text DEFAULT 'self_hosted' NOT NULL,
	"created_by" uuid,
	"is_personal" boolean DEFAULT false NOT NULL,
	"google_place_id" text,
	"branding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"mode" text DEFAULT 'provider' NOT NULL,
	"allow_anonymous" boolean DEFAULT false NOT NULL,
	"access_password_hash" text,
	"greeting_text" text,
	"quick_suggestions_mode" text DEFAULT 'off' NOT NULL,
	"quick_suggestions_count" integer DEFAULT 0 NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"handoff_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collection_fields" jsonb,
	"max_responses" integer,
	"max_agent_responses" integer,
	"total_response_count" integer DEFAULT 0 NOT NULL,
	"google_review_enabled" boolean DEFAULT false NOT NULL,
	"google_place_id" text,
	"retrieval_strategy" text,
	"last_embeddings_sync_at" timestamp with time zone,
	"scheduling_config" jsonb,
	"notification_config" jsonb,
	"booking_config" jsonb,
	"data_config" jsonb,
	"calendar_availability_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hook_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hook_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"message" text NOT NULL,
	"external_user_id" text,
	"conversation_id" uuid,
	"callback_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reply" text,
	"error" text,
	"callback_status" integer,
	"callback_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid,
	"external_id" text,
	"summary" text,
	"closed_at" timestamp with time zone,
	"summary_generated_at" timestamp with time zone,
	"summary_response_count" integer,
	"handed_off" boolean DEFAULT false NOT NULL,
	"handoff_chain" jsonb,
	"response_counts" jsonb,
	"active_agent_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid,
	"event" text NOT NULL,
	"summary" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"processing_started_at" timestamp with time zone,
	"processing_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector",
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_enquiries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"resource_name" text NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"timezone" text NOT NULL,
	"start_datetime" timestamp with time zone NOT NULL,
	"end_datetime" timestamp with time zone NOT NULL,
	"guest_name" text NOT NULL,
	"guest_email" text NOT NULL,
	"guest_phone" text NOT NULL,
	"guest_count" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid,
	"calendar_connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"title" text NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"attendee_name" text NOT NULL,
	"attendee_email" text NOT NULL,
	"description" text,
	"meet_link" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"rescheduled_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"calendar_id" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"api_key_encrypted" text,
	"api_base_url" text,
	"email" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatwoot_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"user_id" uuid,
	"chatwoot_url" text NOT NULL,
	"chatwoot_account_id" integer NOT NULL,
	"chatwoot_inbox_id" integer NOT NULL,
	"chatwoot_inbox_name" text NOT NULL,
	"api_token_encrypted" text NOT NULL,
	"chatwoot_webhook_id" integer,
	"agent_bot_id" integer,
	"agent_bot_name" text,
	"bot_token_encrypted" text,
	"use_agent_bot" boolean DEFAULT false NOT NULL,
	"webhook_secret_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_received_at" timestamp with time zone,
	"total_conversations" integer DEFAULT 0 NOT NULL,
	"disconnected_at" timestamp with time zone,
	"disconnection_reason" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_inbox_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instagram_account_id" text NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text NOT NULL,
	"instagram_username" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webhook_subscribed" boolean DEFAULT false NOT NULL,
	"meta_user_id" text,
	"connection_method" text,
	"meta_app_id" text,
	"meta_app_secret_encrypted" text,
	"webhook_verify_token_encrypted" text,
	"byoa_webhook_url" text,
	"assigned_agent_id" uuid,
	"agent_auto_reply" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_inbox_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_igsid" text NOT NULL,
	"contact_name" text,
	"contact_username" text,
	"contact_profile_pic" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"assigned_to" uuid,
	"assigned_agent_id" uuid,
	"agent_paused" boolean DEFAULT false NOT NULL,
	"agent_handed_off" boolean DEFAULT false NOT NULL,
	"agent_conversation_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instagram_inbox_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"ig_message_id" text NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"media_url" text,
	"caption" text,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"sent_by" text,
	"sent_by_agent_name" text,
	"timestamp_original" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instagram_inbox_messages_ig_message_id_unique" UNIQUE("ig_message_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_inbox_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone_number" text NOT NULL,
	"business_name" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webhook_subscribed" boolean DEFAULT false NOT NULL,
	"connection_method" text,
	"meta_app_id" text,
	"meta_app_secret_encrypted" text,
	"webhook_verify_token_encrypted" text,
	"byoa_webhook_url" text,
	"assigned_agent_id" uuid,
	"agent_auto_reply" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_inbox_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_name" text,
	"contact_profile_name" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"assigned_to" uuid,
	"assigned_agent_id" uuid,
	"agent_paused" boolean DEFAULT false NOT NULL,
	"agent_handed_off" boolean DEFAULT false NOT NULL,
	"agent_conversation_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_inbox_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"wa_message_id" text NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"type" text NOT NULL,
	"text" text,
	"media_url" text,
	"caption" text,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"sent_by" text,
	"sent_by_agent_name" text,
	"timestamp_original" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_inbox_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_value" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tenant_feature_toggles" (
	"tenant_id" uuid NOT NULL,
	"feature_flag_id" uuid NOT NULL,
	"feature_flag_name" text NOT NULL,
	"is_enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_action_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"row_data" jsonb NOT NULL,
	"external_ref" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"email" text,
	"spreadsheet_id" text,
	"sheet_name" text,
	"scopes" jsonb,
	"api_token_encrypted" text,
	"base_id" text,
	"table_id" text,
	"table_name" text,
	"webhook_url" text,
	"webhook_method" text,
	"webhook_headers" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_branding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"logo_url" text,
	"primary_color" text DEFAULT '#0F62FE' NOT NULL,
	"secondary_color" text DEFAULT '#198038' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_branding" (
	"tenant_id" uuid NOT NULL,
	"logo_url" text,
	"primary_color" text DEFAULT '#0F62FE' NOT NULL,
	"secondary_color" text DEFAULT '#198038' NOT NULL,
	"overrides" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_branding_tenant_id_pk" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_links" ADD CONSTRAINT "agent_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_links" ADD CONSTRAINT "agent_links_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_links" ADD CONSTRAINT "agent_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_jobs" ADD CONSTRAINT "hook_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_jobs" ADD CONSTRAINT "hook_jobs_hook_id_hooks_id_fk" FOREIGN KEY ("hook_id") REFERENCES "public"."hooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hook_jobs" ADD CONSTRAINT "hook_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hooks" ADD CONSTRAINT "hooks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_feedback" ADD CONSTRAINT "conversation_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_feedback" ADD CONSTRAINT "conversation_feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_active_agent_id_agents_id_fk" FOREIGN KEY ("active_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_enquiries" ADD CONSTRAINT "booking_enquiries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_enquiries" ADD CONSTRAINT "booking_enquiries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_connection_id_calendar_connections_id_fk" FOREIGN KEY ("calendar_connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatwoot_connections" ADD CONSTRAINT "chatwoot_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatwoot_connections" ADD CONSTRAINT "chatwoot_connections_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatwoot_connections" ADD CONSTRAINT "chatwoot_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_accounts" ADD CONSTRAINT "instagram_inbox_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_accounts" ADD CONSTRAINT "instagram_inbox_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_accounts" ADD CONSTRAINT "instagram_inbox_accounts_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations" ADD CONSTRAINT "instagram_inbox_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations" ADD CONSTRAINT "instagram_inbox_conversations_account_id_instagram_inbox_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."instagram_inbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations" ADD CONSTRAINT "instagram_inbox_conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations" ADD CONSTRAINT "instagram_inbox_conversations_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations" ADD CONSTRAINT "instagram_inbox_conversations_agent_conversation_id_conversations_id_fk" FOREIGN KEY ("agent_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_messages" ADD CONSTRAINT "instagram_inbox_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instagram_inbox_messages" ADD CONSTRAINT "instagram_inbox_messages_conversation_id_instagram_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."instagram_inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_accounts" ADD CONSTRAINT "whatsapp_inbox_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_accounts" ADD CONSTRAINT "whatsapp_inbox_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_accounts" ADD CONSTRAINT "whatsapp_inbox_accounts_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_conversations" ADD CONSTRAINT "whatsapp_inbox_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_conversations" ADD CONSTRAINT "whatsapp_inbox_conversations_account_id_whatsapp_inbox_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."whatsapp_inbox_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_conversations" ADD CONSTRAINT "whatsapp_inbox_conversations_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_conversations" ADD CONSTRAINT "whatsapp_inbox_conversations_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_conversations" ADD CONSTRAINT "whatsapp_inbox_conversations_agent_conversation_id_conversations_id_fk" FOREIGN KEY ("agent_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_messages" ADD CONSTRAINT "whatsapp_inbox_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_inbox_messages" ADD CONSTRAINT "whatsapp_inbox_messages_conversation_id_whatsapp_inbox_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_inbox_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_toggles" ADD CONSTRAINT "tenant_feature_toggles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_feature_toggles" ADD CONSTRAINT "tenant_feature_toggles_feature_flag_id_feature_flags_id_fk" FOREIGN KEY ("feature_flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_action_logs" ADD CONSTRAINT "data_action_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_action_logs" ADD CONSTRAINT "data_action_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_action_logs" ADD CONSTRAINT "data_action_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_action_logs" ADD CONSTRAINT "data_action_logs_connection_id_data_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."data_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connections" ADD CONSTRAINT "data_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_connections" ADD CONSTRAINT "data_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_branding" ADD CONSTRAINT "platform_branding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "tenant_members_user_idx" ON "tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_links_tenant_slug_idx" ON "agent_links" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "agent_links_agent_idx" ON "agent_links" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_slug_idx" ON "agents" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "hook_jobs_hook_idx" ON "hook_jobs" USING btree ("hook_id","created_at");--> statement-breakpoint
CREATE INDEX "hook_jobs_status_idx" ON "hook_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "hooks_agent_idx" ON "hooks" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conversation_feedback_conv_idx" ON "conversation_feedback" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversations_agent_idx" ON "conversations" USING btree ("tenant_id","agent_id","updated_at");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_external_idx" ON "conversations" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "messages_conv_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_idx" ON "notifications" USING btree ("tenant_id","read","created_at");--> statement-breakpoint
CREATE INDEX "files_agent_idx" ON "files" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "files_key_idx" ON "files" USING btree ("file_key");--> statement-breakpoint
CREATE INDEX "embeddings_tenant_src_idx" ON "embeddings" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "embeddings_hnsw_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embeddings_tsv_idx" ON "embeddings" USING gin ("content_tsv");--> statement-breakpoint
CREATE INDEX "booking_enquiries_agent_idx" ON "booking_enquiries" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_agent_idx" ON "bookings" USING btree ("agent_id","start_time");--> statement-breakpoint
CREATE INDEX "bookings_calendar_idx" ON "bookings" USING btree ("calendar_connection_id","start_time");--> statement-breakpoint
CREATE INDEX "calendar_connections_tenant_idx" ON "calendar_connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "chatwoot_connections_agent_idx" ON "chatwoot_connections" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "instagram_accounts_tenant_idx" ON "instagram_inbox_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "instagram_conversations_account_contact_idx" ON "instagram_inbox_conversations" USING btree ("account_id","contact_igsid");--> statement-breakpoint
CREATE INDEX "instagram_messages_conv_idx" ON "instagram_inbox_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_accounts_phone_idx" ON "whatsapp_inbox_accounts" USING btree ("phone_number_id");--> statement-breakpoint
CREATE INDEX "whatsapp_accounts_tenant_idx" ON "whatsapp_inbox_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "whatsapp_conversations_account_contact_idx" ON "whatsapp_inbox_conversations" USING btree ("account_id","contact_phone");--> statement-breakpoint
CREATE INDEX "whatsapp_conversations_agent_idx" ON "whatsapp_inbox_conversations" USING btree ("assigned_agent_id");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_conv_idx" ON "whatsapp_inbox_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_feature_toggles_pk" ON "tenant_feature_toggles" USING btree ("tenant_id","feature_flag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_counters_pk" ON "usage_counters" USING btree ("tenant_id","agent_id","period_start");--> statement-breakpoint
CREATE INDEX "usage_counters_tenant_idx" ON "usage_counters" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE INDEX "data_action_logs_agent_idx" ON "data_action_logs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "data_connections_tenant_idx" ON "data_connections" USING btree ("tenant_id");