import { Cpu } from 'lucide-react'

import type { AiConfiguration } from '@/lib/ai/config'
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
        <Field label="Embedding model">
          <Mono>{plane.models.embed}</Mono>
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
      </div>
      <p className="text-muted-foreground text-sm">
        The app could not reach the AI plane. Check that the service is running
        and that <code className="text-xs">WARDBEAT_AI_URL</code> points at it.
      </p>
    </div>
  )
}
