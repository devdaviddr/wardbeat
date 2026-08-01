import { relations, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

/**
 * Schema is intentionally compatible with the Auth.js Drizzle adapter table
 * conventions (users / accounts / sessions / verificationTokens) so OAuth
 * providers can be dropped in later without a migration rewrite. The
 * credentials flow only needs `users.hashedPassword`.
 */

export const users = pgTable(
  'users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name'),
    // Stored lower-cased by the app layer; unique index enforces one account
    // per address regardless of casing at write time.
    email: text('email').notNull(),
    emailVerified: timestamp('email_verified', { mode: 'date' }),
    // Avatar URL. Populated by an OAuth provider, or by our own upload flow
    // (spec 0018) — set to `/api/files/{avatarFileId}` in that case.
    image: text('image'),
    // Operational pointer to which `files` row (if any) is the current
    // avatar, so replacing/removing one is an explicit swap rather than
    // parsing `image`'s URL. `set null` so a `files` row can never be
    // deleted while this points at it silently.
    avatarFileId: text('avatar_file_id').references(
      (): AnyPgColumn => files.id,
      { onDelete: 'set null' },
    ),
    // Null for accounts created purely via OAuth; set for credentials users.
    hashedPassword: text('hashed_password'),
    // Invite flow: an admin-created (passwordless) user can only claim their
    // account with this token. Stored hashed; cleared once the account is claimed.
    inviteTokenHash: text('invite_token_hash'),
    inviteExpires: timestamp('invite_expires', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('users_email_unique_idx').on(table.email),
    // Defense in depth: enforce case-insensitive uniqueness even if a row is
    // ever inserted without the app's email lowercasing.
    uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`),
  ],
)

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index('accounts_user_id_idx').on(table.userId),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    sessionToken: text('session_token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    // We store the SHA-256 hash of the emailed token here, never the raw value.
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
    // Scopes a token to one flow so it can't be replayed cross-purpose. Null
    // for rows created by the Auth.js adapter (e.g. its own email flows).
    purpose: text('purpose').$type<'password-reset' | 'email-verify'>(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
)

export const authenticators = pgTable(
  'authenticators',
  {
    credentialID: text('credential_id').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerAccountId: text('provider_account_id').notNull(),
    credentialPublicKey: text('credential_public_key').notNull(),
    counter: integer('counter').notNull(),
    credentialDeviceType: text('credential_device_type').notNull(),
    credentialBackedUp: boolean('credential_backed_up').notNull(),
    transports: text('transports'),
  },
  (table) => [primaryKey({ columns: [table.userId, table.credentialID] })],
)

export const roles = pgTable(
  'roles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull().unique(),
    description: text('description'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('roles_name_unique_idx').on(table.name)],
)

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
)

export const files = pgTable(
  'files',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Object key in the S3-compatible bucket — `${ownerId}/${uuid}-${name}`.
    // Cascade-deleting the DB row does NOT delete the underlying object;
    // callers (see admin-actions.ts deleteUser) must remove the object first.
    bucketKey: text('bucket_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('files_owner_id_idx').on(table.ownerId)],
)

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The push service endpoint URL — unique per browser/device subscription.
    endpoint: text('endpoint').notNull().unique(),
    // Web Push encryption keys from the browser's PushSubscription.
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('push_subscriptions_user_id_idx').on(table.userId)],
)

// Drizzle relations — required for `db.query.*` relational queries with `with`.
// These are ORM-only (no database migration).
export const usersRelations = relations(users, ({ many }) => ({
  userRoles: many(userRoles),
  files: many(files),
}))

export const filesRelations = relations(files, ({ one }) => ({
  owner: one(users, {
    fields: [files.ownerId],
    references: [users.id],
  }),
}))

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}))

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Role = typeof roles.$inferSelect
export type NewRole = typeof roles.$inferInsert
export type UserRole = typeof userRoles.$inferSelect
export type NewUserRole = typeof userRoles.$inferInsert
export type FileRecord = typeof files.$inferSelect
export type NewFileRecord = typeof files.$inferInsert
export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert

/* -------------------------------------------------------------------------- */
/* WardBeat — ward-flow domain (spec v0.2.0)                                  */
/*                                                                            */
/* Barrier intelligence & ward board. Synthetic data only in v1 — no PHI.    */
/* `notes.text` is untrusted input; the AI plane extracts structured barriers */
/* from it (see the FastAPI `ai` service). Drizzle owns all migrations; the   */
/* `ai_*`-shaped tables (`ai_extractions`, `barriers`) are written by the     */
/* extraction orchestration in the Next.js server action.                     */
/* -------------------------------------------------------------------------- */

// Barrier taxonomy — why a medically-fit patient is still occupying a bed.
export const BARRIER_TYPES = [
  'tto', // to-take-out medications pending
  'transport',
  'social_care',
  'review', // awaiting specialist / senior review
  'other',
] as const
export type BarrierType = (typeof BARRIER_TYPES)[number]

// `cleared` = the work is done. `dismissed` = the AI got this wrong. They are
// different clinically and must not be collapsed (spec v0.10.0).
export const BARRIER_STATUSES = [
  'pending',
  'in_progress',
  'cleared',
  'dismissed',
] as const
export type BarrierStatus = (typeof BARRIER_STATUSES)[number]

// Who authored a barrier. Extraction only ever reconciles `ai` rows, so a
// clinician-added barrier can never be deleted by a re-run (spec v0.10.0 FR2).
export const BARRIER_ORIGINS = ['ai', 'human'] as const
export type BarrierOrigin = (typeof BARRIER_ORIGINS)[number]

// Append-only lifecycle history. `confirmed`/`unconfirmed` are written by the
// extraction reconcile; the rest by human action.
export const BARRIER_EVENT_KINDS = [
  'created',
  'confirmed',
  'unconfirmed',
  'assigned',
  'unassigned',
  'due_set',
  'commented',
  'cleared',
  'dismissed',
  'reopened',
] as const
export type BarrierEventKind = (typeof BARRIER_EVENT_KINDS)[number]

// Whether the encounter's current EDD came from extraction or a named
// clinician. Extraction must not silently overwrite a human-set date.
export const EDD_SOURCES = ['ai', 'human'] as const
export type EddSource = (typeof EDD_SOURCES)[number]

export const BED_STATUSES = ['free', 'occupied', 'cleaning'] as const
export type BedStatus = (typeof BED_STATUSES)[number]

export const wards = pgTable('wards', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

export const patients = pgTable('patients', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  // Synthetic identifiers only — never real PHI.
  mrn: text('mrn').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

export const beds = pgTable(
  'beds',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    wardId: text('ward_id')
      .notNull()
      .references(() => wards.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    status: text('status').$type<BedStatus>().notNull().default('free'),
  },
  (table) => [index('beds_ward_idx').on(table.wardId)],
)

export const encounters = pgTable(
  'encounters',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    bedId: text('bed_id').references(() => beds.id, { onDelete: 'set null' }),
    admittedAt: timestamp('admitted_at', { mode: 'date' })
      .notNull()
      .defaultNow(),
    dischargedAt: timestamp('discharged_at', { mode: 'date' }),
    // Current discharge status, denormalised from the latest note extraction so
    // the ward board reads without a per-encounter aggregate join.
    mffdFlag: boolean('mffd_flag').notNull().default(false),
    edd: text('edd'), // ISO date string
    // EDD authorship (spec v0.10.0 FR9). A human-set EDD is never silently
    // overwritten by a later extraction.
    eddSource: text('edd_source').$type<EddSource>().notNull().default('ai'),
    eddSetByUserId: text('edd_set_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    eddSetAt: timestamp('edd_set_at', { mode: 'date' }),
    lastExtractedAt: timestamp('last_extracted_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('encounters_bed_idx').on(table.bedId)],
)

export const notes = pgTable(
  'notes',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    authorRole: text('author_role').notNull(),
    // Untrusted free text. The AI plane extracts, it never executes, this.
    text: text('text').notNull(),
    writtenAt: timestamp('written_at', { mode: 'date' }).notNull().defaultNow(),
    // Synthetic ground-truth for the extraction eval harness (F1). Null for
    // any real note; populated by the synthetic seed.
    evalLabels: jsonb('eval_labels'),
    processedAt: timestamp('processed_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('notes_encounter_idx').on(table.encounterId)],
)

export const aiExtractions = pgTable(
  'ai_extractions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    edd: text('edd'), // ISO date string; nullable
    mffdFlag: boolean('mffd_flag').notNull().default(false),
    escalations: jsonb('escalations'),
    grounded: boolean('grounded').notNull().default(true),
    // Raw model output, retained for provenance/audit.
    rawJson: text('raw_json'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('ai_extractions_note_idx').on(table.noteId)],
)

export const barriers = pgTable(
  'barriers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    // Source provenance — every AI barrier must cite the note + span it came
    // from. A human-authored barrier cites the note it was raised against but
    // carries a `description` instead of a quote.
    sourceNoteId: text('source_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    extractionId: text('extraction_id').references(() => aiExtractions.id, {
      onDelete: 'set null',
    }),
    type: text('type').$type<BarrierType>().notNull(),
    status: text('status').$type<BarrierStatus>().notNull().default('pending'),
    sourceQuote: text('source_quote').notNull(),
    sourceStart: integer('source_start'),
    sourceEnd: integer('source_end'),
    confidence: integer('confidence'), // 0-100

    /* -- lifecycle (spec v0.10.0) ------------------------------------------ */
    origin: text('origin').$type<BarrierOrigin>().notNull().default('ai'),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Free text for human-authored barriers; AI barriers use `sourceQuote`.
    description: text('description'),
    ownerUserId: text('owner_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    dueAt: timestamp('due_at', { mode: 'date' }),
    clearedAt: timestamp('cleared_at', { mode: 'date' }),
    clearedReason: text('cleared_reason'),
    clearedByUserId: text('cleared_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Age anchor. Unlike `createdAt` before v0.10.0, this survives a re-run
    // because reconcile updates rows in place instead of deleting them.
    firstSeenAt: timestamp('first_seen_at', { mode: 'date' })
      .notNull()
      .defaultNow(),
    // Last extraction run whose output still supported this barrier.
    lastConfirmedAt: timestamp('last_confirmed_at', { mode: 'date' }),
    // Set when the notes stop supporting it; cleared if it reappears. Never
    // deleted — "the note no longer says this" is not "a human said it's wrong".
    unconfirmedAt: timestamp('unconfirmed_at', { mode: 'date' }),
    // Stable reconcile key: type + normalised source quote. See
    // `src/lib/ward/reconcile.ts`.
    fingerprint: text('fingerprint').notNull().default(''),
    // Set once the overdue sweep has alerted the owner, so re-reading the board
    // doesn't re-notify. Cleared whenever the due time moves.
    overdueNotifiedAt: timestamp('overdue_notified_at', { mode: 'date' }),

    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('barriers_encounter_idx').on(table.encounterId),
    index('barriers_owner_idx').on(table.ownerUserId),
    index('barriers_status_idx').on(table.status),
    index('barriers_fingerprint_idx').on(table.sourceNoteId, table.fingerprint),
  ],
)

/**
 * Append-only lifecycle history for a barrier — the progress thread in the bed
 * drawer and the audit of who did what. Never updated or deleted.
 */
export const barrierEvents = pgTable(
  'barrier_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    barrierId: text('barrier_id')
      .notNull()
      .references(() => barriers.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<BarrierEventKind>().notNull(),
    // Null actor = the system (an extraction run), not a person.
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Comment text, or the reason given when clearing/dismissing/reopening.
    body: text('body'),
    // `{ from, to }` for status transitions, `{ ownerUserId }` for assignment.
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('barrier_events_barrier_idx').on(table.barrierId)],
)

/**
 * Durable dismissal (spec v0.10.0 FR3). Dismissing a barrier records its
 * fingerprint here so a later extraction of the same note does not re-create
 * it — otherwise "the AI got this wrong" would be undone by the next run.
 */
export const barrierSuppressions = pgTable(
  'barrier_suppressions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    sourceNoteId: text('source_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    dismissedByUserId: text('dismissed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('barrier_suppressions_note_fp_uniq').on(
      table.sourceNoteId,
      table.fingerprint,
    ),
  ],
)

export const wardsRelations = relations(wards, ({ many }) => ({
  beds: many(beds),
}))

export const bedsRelations = relations(beds, ({ one, many }) => ({
  ward: one(wards, { fields: [beds.wardId], references: [wards.id] }),
  encounters: many(encounters),
}))

export const patientsRelations = relations(patients, ({ many }) => ({
  encounters: many(encounters),
}))

export const encountersRelations = relations(encounters, ({ one, many }) => ({
  patient: one(patients, {
    fields: [encounters.patientId],
    references: [patients.id],
  }),
  bed: one(beds, { fields: [encounters.bedId], references: [beds.id] }),
  eddSetBy: one(users, {
    fields: [encounters.eddSetByUserId],
    references: [users.id],
  }),
  notes: many(notes),
  barriers: many(barriers),
}))

export const notesRelations = relations(notes, ({ one, many }) => ({
  encounter: one(encounters, {
    fields: [notes.encounterId],
    references: [encounters.id],
  }),
  extractions: many(aiExtractions),
}))

export const aiExtractionsRelations = relations(aiExtractions, ({ one }) => ({
  note: one(notes, { fields: [aiExtractions.noteId], references: [notes.id] }),
}))

export const barriersRelations = relations(barriers, ({ one, many }) => ({
  encounter: one(encounters, {
    fields: [barriers.encounterId],
    references: [encounters.id],
  }),
  sourceNote: one(notes, {
    fields: [barriers.sourceNoteId],
    references: [notes.id],
  }),
  owner: one(users, {
    fields: [barriers.ownerUserId],
    references: [users.id],
  }),
  events: many(barrierEvents),
}))

export const barrierEventsRelations = relations(barrierEvents, ({ one }) => ({
  barrier: one(barriers, {
    fields: [barrierEvents.barrierId],
    references: [barriers.id],
  }),
  actor: one(users, {
    fields: [barrierEvents.actorUserId],
    references: [users.id],
  }),
}))

export type Ward = typeof wards.$inferSelect
export type Patient = typeof patients.$inferSelect
export type Bed = typeof beds.$inferSelect
export type Encounter = typeof encounters.$inferSelect
export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert
export type AiExtraction = typeof aiExtractions.$inferSelect
export type Barrier = typeof barriers.$inferSelect
export type NewBarrier = typeof barriers.$inferInsert
export type BarrierEvent = typeof barrierEvents.$inferSelect
export type NewBarrierEvent = typeof barrierEvents.$inferInsert
export type BarrierSuppression = typeof barrierSuppressions.$inferSelect
export type NewBarrierSuppression = typeof barrierSuppressions.$inferInsert

/* -------------------------------------------------------------------------- */
/* WardBeat — policy knowledge base for the flow copilot (spec v0.3.0)        */
/*                                                                            */
/* Unstructured discharge-policy/criteria docs, chunked and embedded into     */
/* pgvector for the RAG path of the copilot. Synthetic content only. The      */
/* `vector` extension is enabled by this release's first migration.           */
/* Embedding dim 1024 matches nvidia/nv-embedqa-e5-v5 (≤2000 so pgvector's    */
/* hnsw ANN index is supported).                                             */
/* -------------------------------------------------------------------------- */

export const POLICY_EMBED_DIM = 1024

export const policyDocs = pgTable('policy_docs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
})

export const policyChunks = pgTable(
  'policy_chunks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    docId: text('doc_id')
      .notNull()
      .references(() => policyDocs.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: POLICY_EMBED_DIM }),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('policy_chunks_doc_idx').on(table.docId),
    // Approximate-nearest-neighbour index for cosine similarity search.
    index('policy_chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  ],
)

export const policyDocsRelations = relations(policyDocs, ({ many }) => ({
  chunks: many(policyChunks),
}))

export const policyChunksRelations = relations(policyChunks, ({ one }) => ({
  doc: one(policyDocs, {
    fields: [policyChunks.docId],
    references: [policyDocs.id],
  }),
}))

export type PolicyDoc = typeof policyDocs.$inferSelect
export type PolicyChunk = typeof policyChunks.$inferSelect
export type NewPolicyChunk = typeof policyChunks.$inferInsert

/* -------------------------------------------------------------------------- */
/* WardBeat — action recommendations (spec v0.4.0)                            */
/*                                                                            */
/* A retrieve-then-reason agent turns barriers into recommended next-best     */
/* actions, each grounded in discharge policy. Recommend-only: an action is   */
/* only ever a proposal a human approves/dismisses — the sole writes are the  */
/* barrier status change and an audit row. No external side effects.          */
/* -------------------------------------------------------------------------- */

export const ACTION_TYPES = [
  'chase_tto',
  'book_transport',
  'arrange_social_care',
  'escalate_review',
  'other',
] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export const RECOMMENDATION_STATUSES = [
  'proposed',
  'approved',
  'dismissed',
] as const
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number]

export const ACTION_DECISIONS = ['approved', 'dismissed'] as const
export type ActionDecision = (typeof ACTION_DECISIONS)[number]

export const recommendations = pgTable(
  'recommendations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    // Nullable + set null: a re-extraction may replace the source barrier, but
    // a decided recommendation should survive for the audit trail.
    barrierId: text('barrier_id').references(() => barriers.id, {
      onDelete: 'set null',
    }),
    actionType: text('action_type').$type<ActionType>().notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    priority: integer('priority').notNull().default(2), // 1 (high) – 3 (low)
    policyCitation: jsonb('policy_citation'), // [{ text, source }]
    grounded: boolean('grounded').notNull().default(true),
    status: text('status')
      .$type<RecommendationStatus>()
      .notNull()
      .default('proposed'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('recommendations_encounter_idx').on(table.encounterId),
    index('recommendations_status_idx').on(table.status),
  ],
)

export const actionAudit = pgTable(
  'action_audit',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    recommendationId: text('recommendation_id')
      .notNull()
      .references(() => recommendations.id, { onDelete: 'cascade' }),
    decision: text('decision').$type<ActionDecision>().notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('action_audit_recommendation_idx').on(table.recommendationId),
  ],
)

export const recommendationsRelations = relations(
  recommendations,
  ({ one, many }) => ({
    encounter: one(encounters, {
      fields: [recommendations.encounterId],
      references: [encounters.id],
    }),
    barrier: one(barriers, {
      fields: [recommendations.barrierId],
      references: [barriers.id],
    }),
    audit: many(actionAudit),
  }),
)

export const actionAuditRelations = relations(actionAudit, ({ one }) => ({
  recommendation: one(recommendations, {
    fields: [actionAudit.recommendationId],
    references: [recommendations.id],
  }),
}))

export type Recommendation = typeof recommendations.$inferSelect
export type NewRecommendation = typeof recommendations.$inferInsert
export type ActionAudit = typeof actionAudit.$inferSelect
