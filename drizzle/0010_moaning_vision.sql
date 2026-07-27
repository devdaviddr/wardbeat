CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "policy_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"doc_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_docs" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_chunks" ADD CONSTRAINT "policy_chunks_doc_id_policy_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."policy_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_chunks_doc_idx" ON "policy_chunks" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "policy_chunks_embedding_idx" ON "policy_chunks" USING hnsw ("embedding" vector_cosine_ops);