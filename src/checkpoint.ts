import { createHash } from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { z } from 'zod'
import { writeFileAtomically } from './atomic-write.js'

export interface CheckpointIdentityInput {
  source: string | Uint8Array
  targetLocale: string
  pipeline: 'po' | 'readme'
  model: string
  batchSize: number
  onlyMissing: boolean
  context?: string
}

export interface CheckpointIdentity {
  sourceSha256: string
  targetLocale: string
  pipeline: 'po' | 'readme'
  model: string
  batchSize: number
  onlyMissing: boolean
  contextSha256: string
}

export interface CheckpointUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd?: number
}

export interface CheckpointResumeState {
  completedItemIds: string[]
  translations: Record<string, string>
  usage: CheckpointUsage
}

interface CheckpointPayload extends CheckpointResumeState {
  schemaVersion: 1
  identity: CheckpointIdentity
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/

const checkpointIdentitySchema = z.object({
  sourceSha256: z.string().regex(SHA256_PATTERN),
  targetLocale: z.string().min(1),
  pipeline: z.enum(['po', 'readme']),
  model: z.string().min(1),
  batchSize: z.number().int().positive(),
  onlyMissing: z.boolean(),
  contextSha256: z.string().regex(SHA256_PATTERN),
}).strict()

const checkpointUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().finite().nonnegative().optional(),
}).strict().superRefine((usage, context) => {
  if (usage.totalTokens !== usage.promptTokens + usage.completionTokens) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalTokens'],
      message: 'must equal promptTokens plus completionTokens',
    })
  }
})

const checkpointPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  identity: checkpointIdentitySchema,
  completedItemIds: z.array(z.string().min(1)),
  translations: z.record(z.string().min(1), z.string()),
  usage: checkpointUsageSchema,
}).strict().superRefine((payload, context) => {
  const completedItems = new Set(payload.completedItemIds)
  if (completedItems.size !== payload.completedItemIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completedItemIds'],
      message: 'must not contain duplicate identifiers',
    })
  }

  for (const itemId of payload.completedItemIds) {
    if (!Object.hasOwn(payload.translations, itemId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['translations', itemId],
        message: 'must contain every completed item identifier',
      })
    }
  }

  for (const itemId of Object.keys(payload.translations)) {
    if (!completedItems.has(itemId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['translations', itemId],
        message: 'must identify a completed item',
      })
    }
  }
})

const IDENTITY_FIELDS = [
  'sourceSha256',
  'targetLocale',
  'pipeline',
  'model',
  'batchSize',
  'onlyMissing',
  'contextSha256',
] as const satisfies readonly (keyof CheckpointIdentity)[]

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ')
}

export function createCheckpointIdentity(
  input: CheckpointIdentityInput,
): CheckpointIdentity {
  return checkpointIdentitySchema.parse({
    sourceSha256: sha256(input.source),
    targetLocale: input.targetLocale,
    pipeline: input.pipeline,
    model: input.model,
    batchSize: input.batchSize,
    onlyMissing: input.onlyMissing,
    contextSha256: sha256(input.context ?? ''),
  })
}

/** Return the deterministic checkpoint sibling used for one final output. */
export function checkpointPathForOutput(outputPath: string): string {
  return `${outputPath}.po-genie-checkpoint.json`
}

export function loadCheckpoint(
  outputPath: string,
  expectedIdentity: CheckpointIdentity,
): CheckpointResumeState | undefined {
  const checkpointPath = checkpointPathForOutput(outputPath)
  let serialized: string
  try {
    serialized = readFileSync(checkpointPath, 'utf8')
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return undefined
    }
    throw error
  }

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(serialized)
  } catch {
    throw new Error(
      `Checkpoint at ${checkpointPath} contains corrupt JSON. `
      + `Remove ${checkpointPath} to restart this translation.`,
    )
  }

  if (
    typeof rawPayload === 'object'
    && rawPayload !== null
    && 'schemaVersion' in rawPayload
    && typeof rawPayload.schemaVersion === 'number'
    && rawPayload.schemaVersion !== 1
  ) {
    throw new Error(
      `Unsupported checkpoint schema version ${rawPayload.schemaVersion} at ${checkpointPath}. `
      + `Remove ${checkpointPath} to restart this translation.`,
    )
  }

  const parsedPayload = checkpointPayloadSchema.safeParse(rawPayload)
  if (!parsedPayload.success) {
    throw new Error(
      `Invalid checkpoint at ${checkpointPath}: ${formatValidationIssues(parsedPayload.error)}. `
      + `Remove ${checkpointPath} to restart this translation.`,
    )
  }

  const payload = parsedPayload.data
  const mismatchedField = IDENTITY_FIELDS.find(
    (field) => payload.identity[field] !== expectedIdentity[field],
  )
  if (mismatchedField) {
    throw new Error(
      `Checkpoint identity mismatch at ${checkpointPath}: ${mismatchedField} changed. `
      + `Remove ${checkpointPath} to restart this translation.`,
    )
  }

  const { completedItemIds, translations, usage } = payload
  return { completedItemIds, translations, usage }
}

export function saveCheckpoint(
  outputPath: string,
  identity: CheckpointIdentity,
  state: CheckpointResumeState,
): void {
  const rawPayload = {
    schemaVersion: 1,
    identity,
    completedItemIds: state.completedItemIds,
    translations: state.translations,
    usage: state.usage,
  }
  const parsedPayload = checkpointPayloadSchema.safeParse(rawPayload)
  if (!parsedPayload.success) {
    throw new Error(
      `Cannot save invalid checkpoint: ${formatValidationIssues(parsedPayload.error)}`,
    )
  }

  const payload: CheckpointPayload = parsedPayload.data
  writeFileAtomically(
    checkpointPathForOutput(outputPath),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  )
}

export function removeCheckpoint(outputPath: string): void {
  try {
    unlinkSync(checkpointPathForOutput(outputPath))
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return
    }
    throw error
  }
}
