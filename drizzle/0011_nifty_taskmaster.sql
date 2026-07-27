CREATE TABLE "action_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"recommendation_id" text NOT NULL,
	"decision" text NOT NULL,
	"actor_user_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"encounter_id" text NOT NULL,
	"barrier_id" text,
	"action_type" text NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"policy_citation" jsonb,
	"grounded" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_audit" ADD CONSTRAINT "action_audit_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_audit" ADD CONSTRAINT "action_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_barrier_id_barriers_id_fk" FOREIGN KEY ("barrier_id") REFERENCES "public"."barriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_audit_recommendation_idx" ON "action_audit" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "recommendations_encounter_idx" ON "recommendations" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "recommendations_status_idx" ON "recommendations" USING btree ("status");