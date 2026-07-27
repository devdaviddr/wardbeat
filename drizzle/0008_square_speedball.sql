CREATE TABLE "ai_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"model" text NOT NULL,
	"edd" text,
	"mffd_flag" boolean DEFAULT false NOT NULL,
	"escalations" jsonb,
	"grounded" boolean DEFAULT true NOT NULL,
	"raw_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "barriers" (
	"id" text PRIMARY KEY NOT NULL,
	"encounter_id" text NOT NULL,
	"source_note_id" text NOT NULL,
	"extraction_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_quote" text NOT NULL,
	"source_start" integer,
	"source_end" integer,
	"confidence" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beds" (
	"id" text PRIMARY KEY NOT NULL,
	"ward_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'free' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_id" text NOT NULL,
	"bed_id" text,
	"admitted_at" timestamp DEFAULT now() NOT NULL,
	"discharged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"encounter_id" text NOT NULL,
	"author_role" text NOT NULL,
	"text" text NOT NULL,
	"written_at" timestamp DEFAULT now() NOT NULL,
	"eval_labels" jsonb,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"mrn" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barriers" ADD CONSTRAINT "barriers_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barriers" ADD CONSTRAINT "barriers_source_note_id_notes_id_fk" FOREIGN KEY ("source_note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barriers" ADD CONSTRAINT "barriers_extraction_id_ai_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."ai_extractions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds" ADD CONSTRAINT "beds_ward_id_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."wards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_bed_id_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "public"."beds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_extractions_note_idx" ON "ai_extractions" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "barriers_encounter_idx" ON "barriers" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "beds_ward_idx" ON "beds" USING btree ("ward_id");--> statement-breakpoint
CREATE INDEX "encounters_bed_idx" ON "encounters" USING btree ("bed_id");--> statement-breakpoint
CREATE INDEX "notes_encounter_idx" ON "notes" USING btree ("encounter_id");