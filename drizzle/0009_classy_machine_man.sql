ALTER TABLE "encounters" ADD COLUMN "mffd_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "edd" text;--> statement-breakpoint
ALTER TABLE "encounters" ADD COLUMN "last_extracted_at" timestamp;