import 'server-only'

import { z } from 'zod'

import { env } from '@/lib/env'

/**
 * Server-side client for the internal FastAPI `ai` service (barrier extraction).
 * Never import this into a client component — the service token must not reach
 * the browser. The response is Zod-validated at this boundary (the Python side
 * is the source of truth for the shape via its OpenAPI contract).
 */

const barrierSchema = z.object({
  type: z.enum(['tto', 'transport', 'social_care', 'review', 'other']),
  status: z.enum(['pending', 'in_progress', 'cleared']).default('pending'),
  source: z.object({
    start: z.number().int().nullable().optional(),
    end: z.number().int().nullable().optional(),
    quote: z.string(),
  }),
  confidence: z.number().int().min(0).max(100).default(80),
})

const extractionResultSchema = z.object({
  note_id: z.string(),
  model: z.string(),
  edd: z.string().nullable().optional(),
  mffd_flag: z.boolean(),
  barriers: z.array(barrierSchema),
  escalations: z.array(z.string()).default([]),
  grounded: z.boolean(),
})

export type ExtractionResult = z.infer<typeof extractionResultSchema>
export type ExtractedBarrier = z.infer<typeof barrierSchema>

export async function extractNote(input: {
  noteId: string
  encounterId?: string
  text: string
}): Promise<ExtractionResult> {
  const res = await fetch(`${env.WARDBEAT_AI_URL}/extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.WARDBEAT_AI_SERVICE_TOKEN
        ? { 'x-service-token': env.WARDBEAT_AI_SERVICE_TOKEN }
        : {}),
    },
    body: JSON.stringify({
      note_id: input.noteId,
      encounter_id: input.encounterId ?? null,
      text: input.text,
    }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI service error ${res.status}: ${detail.slice(0, 200)}`)
  }

  return extractionResultSchema.parse(await res.json())
}
