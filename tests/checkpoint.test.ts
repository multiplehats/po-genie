import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkpointPathForOutput,
  createCheckpointIdentity,
  loadCheckpoint,
  removeCheckpoint,
  saveCheckpoint,
} from '../src/checkpoint.js'
import type {
  CheckpointIdentityInput,
  CheckpointResumeState,
} from '../src/checkpoint.js'

const RESUME_STATE = {
  completedItemIds: ['po:Save settings:0'],
  translations: {
    'po:Save settings:0': 'Instellingen opslaan',
  },
  usage: {
    promptTokens: 100,
    completionTokens: 25,
    totalTokens: 125,
    estimatedCostUsd: 0.00018,
  },
}

let temporaryDirectory: string
let outputPath: string

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'po-genie-checkpoint-'))
  outputPath = join(temporaryDirectory, 'messages-nl_NL.po')
})

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true })
})

function createIdentity() {
  return createCheckpointIdentity(identityInput())
}

function identityInput(
  overrides: Partial<CheckpointIdentityInput> = {},
): CheckpointIdentityInput {
  return {
    source: 'source bytes',
    targetLocale: 'nl_NL',
    pipeline: 'po',
    model: 'openai/gpt-4o-mini',
    batchSize: 20,
    onlyMissing: true,
    context: 'Project: checkout flow',
    ...overrides,
  }
}

describe('translation checkpoints', () => {
  it('creates a safe identity from every output-affecting input', () => {
    expect(createIdentity()).toEqual({
      sourceSha256: '4d4823794cbed3c4ee0bbc684c8f66e1dfd5afa6f078d494ce254ec5a4671753',
      targetLocale: 'nl_NL',
      pipeline: 'po',
      model: 'openai/gpt-4o-mini',
      batchSize: 20,
      onlyMissing: true,
      contextSha256: 'da0dcaffaa5bf33333d7e1a6fed3647ab3911d15d8a5331db6905d4214b71b3f',
    })
  })

  it('uses one deterministic sibling path for an output', () => {
    expect(checkpointPathForOutput(outputPath)).toBe(
      `${outputPath}.po-genie-checkpoint.json`,
    )
  })

  it('returns no resume state when the checkpoint is missing', () => {
    expect(loadCheckpoint(outputPath, createIdentity())).toBeUndefined()
  })

  it('atomically saves a versioned checkpoint and loads matching resume state', () => {
    saveCheckpoint(outputPath, createIdentity(), RESUME_STATE)

    expect(loadCheckpoint(outputPath, createIdentity())).toEqual(RESUME_STATE)
    expect(JSON.parse(readFileSync(checkpointPathForOutput(outputPath), 'utf8'))).toEqual({
      schemaVersion: 1,
      identity: createIdentity(),
      ...RESUME_STATE,
    })
  })

  it.each([
    ['sourceSha256', { source: 'new source bytes' }],
    ['targetLocale', { targetLocale: 'de_DE' }],
    ['pipeline', { pipeline: 'readme' as const }],
    ['model', { model: 'anthropic/claude-3.5-haiku' }],
    ['batchSize', { batchSize: 10 }],
    ['onlyMissing', { onlyMissing: false }],
    ['contextSha256', { context: 'Project: account settings' }],
  ])(
    'rejects a changed %s and leaves the checkpoint byte-identical',
    (field, overrides) => {
      saveCheckpoint(outputPath, createIdentity(), RESUME_STATE)
      const checkpointPath = checkpointPathForOutput(outputPath)
      const originalBytes = readFileSync(checkpointPath)
      const changedIdentity = createCheckpointIdentity(identityInput(overrides))

      expect(() => loadCheckpoint(outputPath, changedIdentity)).toThrow(
        new RegExp(`identity mismatch.*${field}.*remove`, 'i'),
      )
      expect(readFileSync(checkpointPath)).toEqual(originalBytes)
    },
  )

  it('rejects corrupt JSON actionably and leaves its bytes untouched', () => {
    const checkpointPath = checkpointPathForOutput(outputPath)
    const corruptBytes = Buffer.from('{"schemaVersion":1,broken')
    writeFileSync(checkpointPath, corruptBytes)

    expect(() => loadCheckpoint(outputPath, createIdentity())).toThrow(
      /corrupt JSON.*remove/i,
    )
    expect(readFileSync(checkpointPath)).toEqual(corruptBytes)
  })

  it('rejects malformed field types actionably and leaves the checkpoint untouched', () => {
    saveCheckpoint(outputPath, createIdentity(), RESUME_STATE)
    const checkpointPath = checkpointPathForOutput(outputPath)
    const malformedPayload = JSON.parse(readFileSync(checkpointPath, 'utf8'))
    malformedPayload.completedItemIds = 'po:Save settings:0'
    const malformedBytes = Buffer.from(JSON.stringify(malformedPayload))
    writeFileSync(checkpointPath, malformedBytes)

    expect(() => loadCheckpoint(outputPath, createIdentity())).toThrow(
      /invalid checkpoint.*completedItemIds.*remove/i,
    )
    expect(readFileSync(checkpointPath)).toEqual(malformedBytes)
  })

  it('rejects unsupported schema versions without changing the checkpoint', () => {
    saveCheckpoint(outputPath, createIdentity(), RESUME_STATE)
    const checkpointPath = checkpointPathForOutput(outputPath)
    const unsupportedPayload = JSON.parse(readFileSync(checkpointPath, 'utf8'))
    unsupportedPayload.schemaVersion = 2
    const unsupportedBytes = Buffer.from(JSON.stringify(unsupportedPayload))
    writeFileSync(checkpointPath, unsupportedBytes)

    expect(() => loadCheckpoint(outputPath, createIdentity())).toThrow(
      /unsupported checkpoint schema version 2.*remove/i,
    )
    expect(readFileSync(checkpointPath)).toEqual(unsupportedBytes)
  })

  it('persists only safe resume fields and never raw context or credential and prompt fields', () => {
    const unsafeRuntimeState = {
      ...RESUME_STATE,
      apiKey: 'sk-never-write-this',
      providerCredentials: 'provider-secret',
      systemPrompt: 'unrestricted system prompt',
      userPrompt: 'unrestricted user prompt',
      callback: () => undefined,
      outputFileContents: 'complete output file',
      context: 'Project: checkout flow',
    } as unknown as CheckpointResumeState

    saveCheckpoint(outputPath, createIdentity(), unsafeRuntimeState)

    const serialized = readFileSync(checkpointPathForOutput(outputPath), 'utf8')
    expect(serialized).not.toContain('Project: checkout flow')
    expect(serialized).not.toContain('sk-never-write-this')
    expect(serialized).not.toContain('provider-secret')
    expect(serialized).not.toContain('unrestricted system prompt')
    expect(serialized).not.toContain('unrestricted user prompt')
    expect(serialized).not.toContain('complete output file')
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual([
      'completedItemIds',
      'identity',
      'schemaVersion',
      'translations',
      'usage',
    ])
  })

  it('removes a checkpoint after success and tolerates an already missing file', () => {
    saveCheckpoint(outputPath, createIdentity(), RESUME_STATE)

    removeCheckpoint(outputPath)
    removeCheckpoint(outputPath)

    expect(existsSync(checkpointPathForOutput(outputPath))).toBe(false)
  })
})
