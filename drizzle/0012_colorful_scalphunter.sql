CREATE TABLE "barrier_events" (
	"id" text PRIMARY KEY NOT NULL,
	"barrier_id" text NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"body" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barrier_suppressions" (
	"id" text PRIMARY KEY NOT NULL,
	"encounter_id" text NOT NULL,
	"source_note_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"dismissed_by_user_id" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "origin" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "due_at" timestamp;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "cleared_at" timestamp;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "cleared_reason" text;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "cleared_by_user_id" text;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "first_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "last_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "unconfirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "barriers" ADD COLUMN "fingerprint" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "edd_source" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "edd_set_by_user_id" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "edd_set_at" timestamp;--> statement-breakpoint
ALTER TABLE "barrier_events" ADD CONSTRAINT "barrier_events_barrier_id_barriers_id_fk" FOREIGN KEY ("barrier_id") REFERENCES "public"."barriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barrier_events" ADD CONSTRAINT "barrier_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barrier_suppressions" ADD CONSTRAINT "barrier_suppressions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barrier_suppressions" ADD CONSTRAINT "barrier_suppressions_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barrier_suppressions" ADD CONSTRAINT "barrier_suppressions_dismissed_by_user_id_users_id_fk" FOREIGN KEY ("dismissed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "barrier_events_barrier_idx" ON "barrier_events" USING btree ("barrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "barrier_suppressions_note_fp_uniq" ON "barrier_suppressions" USING btree ("source_note_id","fingerprint");--> statement-breakpoint
ALTER TABLE "barriers" ADD CONSTRAINT "barriers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barriers" ADD CONSTRAINT "barriers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barriers" ADD CONSTRAINT "barriers_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_edd_set_by_user_id_users_id_fk" FOREIGN KEY ("edd_set_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "barriers_owner_idx" ON "barriers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "barriers_status_idx" ON "barriers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "barriers_fingerprint_idx" ON "barriers" USING btree ("source_note_id","fingerprint");--> statement-breakpoint
-- Backfill for v0.10.0 (close the loop).
--
-- `first_seen_at` is the barrier's age anchor. Before this release a re-run
-- deleted and re-inserted every barrier, so `created_at` was reset on each
-- extraction; it is nonetheless the best evidence we have for existing rows.
UPDATE "barriers" SET "first_seen_at" = "created_at";--> statement-breakpoint
-- Existing AI barriers were confirmed by whatever run last wrote them.
UPDATE "barriers" SET "last_confirmed_at" = "created_at" WHERE "origin" = 'ai';--> statement-breakpoint
-- Fingerprint = sha256('<type>:<normalised quote>'), matching
-- `barrierFingerprint()` in src/lib/ward/reconcile.ts: lowercase, drop
-- punctuation, collapse whitespace, trim. Keep the two in step — if they drift,
-- the first extraction after this migration re-inserts every barrier as new and
-- unconfirms the originals instead of matching them.
UPDATE "barriers"
SET "fingerprint" = encode(
  sha256(
    convert_to(
      "type" || ':' || btrim(
        regexp_replace(
          regexp_replace(lower("source_quote"), '[^[:alnum:][:space:]]', '', 'g'),
          '\s+', ' ', 'g'
        )
      ),
      'UTF8'
    )
  ),
  'hex'
)
WHERE "fingerprint" = '';
