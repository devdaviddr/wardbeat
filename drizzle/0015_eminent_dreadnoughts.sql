CREATE TABLE "access_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"surface" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_wards" (
	"user_id" text NOT NULL,
	"ward_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_wards_user_id_ward_id_pk" PRIMARY KEY("user_id","ward_id")
);
--> statement-breakpoint
ALTER TABLE "access_audit" ADD CONSTRAINT "access_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wards" ADD CONSTRAINT "user_wards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wards" ADD CONSTRAINT "user_wards_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_audit_actor_created_idx" ON "access_audit" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "access_audit_subject_created_idx" ON "access_audit" USING btree ("subject_id","created_at");--> statement-breakpoint
-- v0.12.0 clinical role vocabulary (spec FR1). Idempotent: `roles.name` is unique.
-- `admin`, `member` and `viewer` already exist via db:seed and are untouched.
INSERT INTO "roles" ("id", "name", "description") VALUES
	(gen_random_uuid()::text, 'bed_manager', 'Bed manager — full ward flow control, including extraction and recommendation runs'),
	(gen_random_uuid()::text, 'charge_nurse', 'Charge nurse — acts on barriers and approvals within assigned wards'),
	(gen_random_uuid()::text, 'clinician', 'Clinician — acts on barriers and approvals within assigned wards'),
	(gen_random_uuid()::text, 'allied_health', 'Allied health — works barriers within assigned wards; no EDD override or approvals')
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
-- ============================================================================
-- v0.12.0 PRIVILEGE-GRANTING BACKFILL — read before running against real data.
--
-- DEFAULT 1: every existing user who does NOT hold `admin` is granted
--            `bed_manager`. That is the de-facto capability every user had
--            before this release (there were no role checks on the ward
--            surface), so nobody loses access on upgrade.
-- DEFAULT 2: every existing user (admins included) is granted membership of
--            EVERY existing ward, because pre-v0.12.0 there was no membership
--            concept and all users could see all wards.
--
-- Both defaults are deliberate and stated in the release notes; review the
-- grants after upgrade and narrow them in Settings → Administration.
-- Idempotent: only missing rows are inserted; a fresh (empty) database grants
-- nothing.
-- ============================================================================
DO $$
DECLARE
	granted_bed_manager integer;
	granted_memberships integer;
BEGIN
	INSERT INTO "user_roles" ("user_id", "role_id")
	SELECT u."id", r."id"
	FROM "users" u
	CROSS JOIN "roles" r
	WHERE r."name" = 'bed_manager'
		AND NOT EXISTS (
			SELECT 1
			FROM "user_roles" ur
			JOIN "roles" ar ON ar."id" = ur."role_id"
			WHERE ur."user_id" = u."id" AND ar."name" = 'admin'
		)
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS granted_bed_manager = ROW_COUNT;

	INSERT INTO "user_wards" ("user_id", "ward_id")
	SELECT u."id", w."id"
	FROM "users" u
	CROSS JOIN "wards" w
	ON CONFLICT DO NOTHING;
	GET DIAGNOSTICS granted_memberships = ROW_COUNT;

	RAISE NOTICE 'v0.12.0 backfill: granted the bed_manager role to % existing non-admin user(s) — the de-facto capability they already had before role checks existed.', granted_bed_manager;
	RAISE NOTICE 'v0.12.0 backfill: granted % ward membership row(s) — every existing user is now a member of every existing ward. Review and narrow in Settings -> Administration.', granted_memberships;
END $$;