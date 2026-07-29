# Plan 009: Preserve completed paid batches and make output replacement atomic

> **Executor instructions**: Execute only after Plan 007 is DONE. Follow verification gates exactly and update the index.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/translate.ts src/po.ts src/readme.ts src/types.ts tests/translate.test.ts tests/translate-readme.test.ts tests/po.test.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/007-enforce-output-integrity.md`
- **Category**: perf
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

Each paid batch lives only in memory until the whole locale succeeds. A later transient failure forces users to repay and wait for earlier work. Direct writes can also truncate the only in-place PO file if the process or disk fails during replacement.

## Current state

- PO batches run at `src/translate.ts:299-322`; the sole save is line 324.
- Readme batches run at `src/translate.ts:182-219`; the sole save is line 221.
- `src/po.ts:40-43` and `src/readme.ts:241-245` use direct `writeFileSync`.
- Tests mock deterministic provider responses and use temporary directories with cleanup.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/po.test.ts tests/translate.test.ts tests/translate-readme.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/translate.ts`
- `src/po.ts`
- `src/readme.ts`
- `src/types.ts` if resume/result semantics need a documented field
- a new internal checkpoint/atomic-write module under `src/`
- focused test files

**Out of scope**:
- Global locale concurrency (Plan 010)
- Budget limits
- Persisting API keys, raw credentials, or full prompts
- Treating invalid output from Plan 007 as checkpointable

## Git workflow

- Branch: `advisor/009-failure-safe-runs`
- Commit example: `feat: resume translation batches safely`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Introduce atomic destination writes

Create one helper that writes a complete temporary sibling file, closes it, and renames it over the destination. Clean up the temp file on failure without touching the existing destination. Use explicit unique temp names and preserve Buffer versus UTF-8 content.

Route both `POFile.save` and `ReadmeFile.save` through it.

**Verify**: `pnpm exec vitest run tests/po.test.ts tests/readme.test.ts` → atomic success and injected-failure cases pass; the original remains byte-identical on failure.

### Step 2: Define a safe checkpoint identity

Create a versioned checkpoint format containing only what is needed to resume: a cryptographic hash of source content, locale, model/options that affect output, completed item/form identifiers, validated translations, and accumulated usage. Never store `apiKey`, environment values, or unrestricted system/user prompts.

Store checkpoints beside the final output using atomic writes. On startup, resume only when identity and schema version match exactly; otherwise leave the checkpoint untouched and return an actionable mismatch error.

**Verify**: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → matching, stale-source, option-mismatch, corrupt-JSON, and no-secret cases pass.

### Step 3: Checkpoint after each validated batch

After Plan 007 validation and in-memory application, atomically update the checkpoint. On successful completion, atomically write final output and remove the checkpoint. Use bounded retry/backoff only for provider failures classified as transient; cap attempts and never retry integrity/schema failures automatically.

Define usage as total known spend for the resumed job, including checkpointed successful calls. Document whether failed-attempt usage is unavailable.

**Verify**: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → second-batch failure, resume, and permanent-failure cases pass; the first batch is not requested twice.

### Step 4: Test both formats and in-place behavior

Cover PO, readme, default output, and in-place PO. Assert progress continues from resumed work, the original remains valid at every simulated write failure, successful completion removes the checkpoint, and corrupt/stale checkpoints do not overwrite data.

**Verify**: `pnpm test` → all tests pass.

## Test plan

- Add atomic-write cases beside `tests/po.test.ts`/`tests/readme.test.ts` or in one focused helper test.
- Add PO and readme checkpoint tests with deterministic second-batch rejection and a fresh invocation that resumes.
- Cover stale source, changed options, corrupt checkpoint, permanent error, cleanup, progress continuation, usage, and absence of credential fields.
- Verification: `pnpm exec vitest run tests/po.test.ts tests/readme.test.ts tests/translate.test.ts tests/translate-readme.test.ts` → all pass.

## Done criteria

- [ ] Output replacement is atomic for PO and readme.
- [ ] A later-batch failure can resume without repaying completed batches.
- [ ] Checkpoints never contain credentials.
- [ ] Only Plan 007-validated output is persisted.
- [ ] Retry attempts are bounded and classified.
- [ ] Focused tests, typecheck, and full suite pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Plan 007 is incomplete.
- Plan 003 changed entry identity and no stable form identifier is available.
- Atomic rename semantics cannot be tested on the supported Node 20 platforms.
- Resuming would require storing credentials or full sensitive prompts.

## Maintenance notes

Version checkpoint schemas. Reviewers should scrutinize source identity, cleanup, retry classification, usage accounting, and every path that replaces an in-place file.
