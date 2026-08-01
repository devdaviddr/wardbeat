import { Cpu } from 'lucide-react'

import type { AiConfiguration, StoredEmbeddingState } from '@/lib/ai/config'
import {
  effectiveEmbeddingModel,
  UNKNOWN_EMBEDDING_MODEL,
} from '@/lib/ai/embedding-model'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'

/**
 * Read-only view of the AI plane's live configuration (admin-only). Values come
 * straight from the AI service's `/config` endpoint — the single source of
 * truth — so the app never drifts from what the service actually uses. No secret
 * value is ever shown; credentials appear only as "configured" / "not set".
 */
export function AiConfigCard({ config }: { config: AiConfiguration }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          AI configuration
        </CardTitle>
        <CardDescription>
          How the system&apos;s AI plane is wired right now — read-only, set by
          the deployment environment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {config.reachable ? (
          <ReachableBody config={config} />
        ) : (
          <UnreachableBody config={config} />
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground text-sm font-medium">
        {label}
      </Label>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted rounded px-2 py-1 text-xs break-all">
      {children}
    </code>
  )
}

function YesNo({ value }: { value: boolean }) {
  return (
    <span className={value ? 'text-foreground' : 'text-muted-foreground'}>
      {value ? 'Configured' : 'Not set'}
    </span>
  )
}

function ReachableBody({
  config,
}: {
  config: Extract<AiConfiguration, { reachable: true }>
}) {
  const { plane } = config
  const live = plane.mode === 'live'
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Reachable
        </Badge>
        <Badge
          className={
            live
              ? 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          }
        >
          {live ? 'Live · NVIDIA NIM' : 'Mock · deterministic'}
        </Badge>
        <span className="text-muted-foreground text-xs">
          AI plane v{plane.service_version}
        </span>
      </div>

      {!live && (
        <p className="text-muted-foreground text-sm">
          Running the deterministic offline mock — no model calls leave the
          system. Set a NVIDIA API key and turn the mock off to run live.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Extraction model">
          <Mono>{plane.models.extract}</Mono>
        </Field>
        <Field label="Embedding model (configured)">
          <Mono>{effectiveEmbeddingModel(plane)}</Mono>
          {!live && (
            <p className="text-muted-foreground mt-1 text-xs">
              Hash-derived mock vectors. Would use{' '}
              <code className="text-[11px]">{plane.models.embed}</code> when
              live.
            </p>
          )}
        </Field>
        <Field label="Embedding model (stored policy vectors)">
          <StoredEmbeddingField
            stored={config.storedEmbedding}
            configured={effectiveEmbeddingModel(plane)}
          />
        </Field>
        <Field label="Rerank model">
          <Mono>{plane.models.rerank}</Mono>
        </Field>
        <Field label="Model endpoint">
          <Mono>{plane.endpoint_host}</Mono>
        </Field>
        <Field label="Rate-limit budget">{plane.rate_limit_rpm} req/min</Field>
        <Field label="Request timeout">{plane.timeout_seconds}s</Field>
        <Field label="Embedding dimensions">{plane.embed_dim}</Field>
        <Field label="NVIDIA API key">
          <YesNo value={plane.api_key_configured} />
        </Field>
        <Field label="Service token">
          <YesNo value={plane.service_token_required} />
        </Field>
      </div>
    </>
  )
}

/**
 * The half of the embedding-drift picture that lives in the database (spec
 * v0.11.0 FR8): which model built the policy vectors pgvector is searching.
 *
 * Worth stating plainly because nothing else exposes it. Seed the KB under
 * `NIM_MOCK=true`, switch to a live key, and every policy answer is built from
 * a cosine comparison between two unrelated 1024-d spaces — no error anywhere,
 * and a green grounded badge on top. This field is where an admin finds out.
 */
function StoredEmbeddingField({
  stored,
  configured,
}: {
  stored: StoredEmbeddingState | null
  configured: string
}) {
  if (!stored) {
    return (
      <span className="text-muted-foreground">
        Could not read the policy knowledge base.
      </span>
    )
  }
  if (stored.chunkCount === 0) {
    return (
      <span className="text-muted-foreground">
        No policy chunks seeded — run <code>pnpm db:seed:policy</code>.
      </span>
    )
  }

  const labels = stored.models.map((m) => m ?? UNKNOWN_EMBEDDING_MODEL)
  const matches = labels.length === 1 && labels[0] === configured
  const hasUnknown = stored.models.some((m) => m == null)

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.map((m) => (
          <Mono key={m}>{m}</Mono>
        ))}
        <span className="text-muted-foreground text-xs">
          ({stored.chunkCount} chunks)
        </span>
      </div>
      {matches ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          ● Matches the configured model — policy search is comparing like with
          like.
        </p>
      ) : (
        <p className="text-xs text-red-700 dark:text-red-400">
          ▲ Does not match the configured model (
          <code className="text-[11px]">{configured}</code>). Policy search is
          comparing unrelated vector spaces and will return plausible nonsense.
          Re-seed with <code className="text-[11px]">pnpm db:seed:policy</code>.
        </p>
      )}
      {hasUnknown && (
        <p className="text-muted-foreground text-xs">
          <code className="text-[11px]">{UNKNOWN_EMBEDDING_MODEL}</code> means
          the row predates v0.11.0 and carries no record of what embedded it —
          the migration&apos;s backfill has not run against it. Treat those
          vectors as unverified; re-seeding is the only way to know.
        </p>
      )}
    </div>
  )
}

function UnreachableBody({
  config,
}: {
  config: Extract<AiConfiguration, { reachable: false }>
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
          Unreachable
        </Badge>
        <span className="text-muted-foreground text-sm">{config.error}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Configured endpoint">
          <Mono>{config.aiUrlHost}</Mono>
        </Field>
        <Field label="Service token (app side)">
          <YesNo value={config.serviceTokenConfigured} />
        </Field>
        <Field label="Embedding model (stored policy vectors)">
          {config.storedEmbedding ? (
            <span className="text-muted-foreground text-sm">
              {config.storedEmbedding.chunkCount === 0
                ? 'No policy chunks seeded.'
                : `${config.storedEmbedding.models
                    .map((m) => m ?? UNKNOWN_EMBEDDING_MODEL)
                    .join(
                      ', ',
                    )} (${config.storedEmbedding.chunkCount} chunks). ` +
                  'Cannot be compared while the AI plane is unreachable.'}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">
              Could not read the policy knowledge base.
            </span>
          )}
        </Field>
      </div>
      <p className="text-muted-foreground text-sm">
        The app could not reach the AI plane. Check that the service is running
        and that <code className="text-xs">WARDBEAT_AI_URL</code> points at it.
      </p>
    </div>
  )
}
