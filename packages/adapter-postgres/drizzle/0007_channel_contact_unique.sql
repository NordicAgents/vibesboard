ALTER TABLE "whatsapp_inbox_conversations"
  ADD CONSTRAINT "whatsapp_conversations_account_contact_uniq" UNIQUE ("account_id", "contact_phone");--> statement-breakpoint
ALTER TABLE "instagram_inbox_conversations"
  ADD CONSTRAINT "instagram_conversations_account_contact_uniq" UNIQUE ("account_id", "contact_igsid");
