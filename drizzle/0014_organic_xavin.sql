-- v0.11.0 FR8 / FR4 — record how a stored artefact was produced.
--
-- `policy_chunks.embedding_model`  which embedding model built the vector, so a
--   KB seeded in mock mode and queried in live mode is detected instead of
--   returning plausible garbage from an unrelated 1024-d vector space.
-- `recommendations.provenance`     live | mock | fallback, mirroring `grounded`.
--
-- Both are nullable and null means UNKNOWN, not "same as configured".
-- The `embedding_model` backfill cannot live here: the currently-configured
-- model is in the AI plane's environment, not the database. `src/db/migrate.ts`
-- performs it immediately after this migration and logs loudly that stamping
-- existing rows is an assumption, not a fact (remedy: `pnpm db:seed:policy`).
-- `recommendations.provenance` is deliberately NOT backfilled — inventing a
-- provenance for rows produced before provenance existed is the exact failure
-- this release is about.
ALTER TABLE "policy_chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "provenance" text;
