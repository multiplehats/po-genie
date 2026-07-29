# Plan 010: Bound locale concurrency and settle all started work before returning

> **Executor instructions**: Execute after Plan 004. Run every verification gate and update the index row.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/translate.ts src/types.ts src/cli.ts tests/translate.test.ts tests/translate-readme.test.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/004-route-multi-locale-output.md`, `plans/009-make-runs-failure-safe.md`
- **Category**: perf
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

One locale serializes all batches, while multiple locales launch one provider call each without a cap. `Promise.all` rejects on the first failure even though sibling work continues and may write later. Callers need a deterministic concurrency ceiling and explicit partial-failure semantics.

## Current state

`src/translate.ts:338-340`:

```ts
const locales = Array.isArray(options.locale) ? options.locale : [options.locale]
return Promise.all(locales.map((locale) => translateFile({ ...options, locale })))
```

`src/cli.ts:111-114` calls `process.exit(1)` immediately on the first rejected top-level call. `TranslateOptions` exposes batch size but no concurrency option.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/translate.ts`
- `src/types.ts`
- `src/cli.ts`
- `tests/translate.test.ts`
- `tests/translate-readme.test.ts`

**Out of scope**:
- Changing batch size semantics
- Provider-specific rate-limit detection beyond Plan 009 retry classification
- Cancelling requests unless the installed SDK already supports safe cancellation
- Changing output routing from Plan 004

## Git workflow

- Branch: `advisor/010-concurrency`
- Commit example: `feat: bound locale translation concurrency`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define the public concurrency contract

Add an optional positive-integer `concurrency` setting and CLI flag. Choose a conservative documented default (recommended: 2) and reuse Plan 001's validation pattern. The limit applies globally across locale jobs; do not create one independent limiter per locale.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Replace fail-fast fan-out

Implement a small internal bounded scheduler or use an already-installed suitable primitive. Preserve input locale result order regardless of completion order. Let every started job settle; do not start more after a policy-defined fatal failure if doing so is avoidable.

If any locale fails, throw a documented aggregate error after started work settles. Include locale-level failures and successful `TranslateResult`s without source strings, prompts, or credentials.

**Verify**: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → deferred-promise tests show in-flight work never exceeds the cap.

### Step 3: Make CLI exit cooperative

Replace immediate `process.exit(1)` with `process.exitCode = 1` after aggregate reporting so stdout/stderr flush and started work is not killed. Report successful outputs and failed locales clearly without exposing sensitive request content.

**Verify**: `pnpm exec vitest run tests/cli.test.ts` (create if needed) → nonzero exit state is asserted only after all mocked jobs settle.

### Step 4: Cover ordering and failures

Test concurrency 1 and 2, invalid values, stable result order, one early failure with later success, multiple failures, and progress locale tags. Use deferred promises/counters, never timers that make tests flaky.

**Verify**: `pnpm test` → all tests pass.

## Test plan

- Use controllable deferred promises and an in-flight counter; avoid elapsed-time assertions.
- Cover caps 1 and 2, invalid caps, stable order, early failure with later success, multiple failures, and locale-tagged progress.
- Add CLI command-factory/subprocess coverage for aggregate reporting and `process.exitCode`.
- Verification: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts tests/cli.test.ts` → all pass.

## Done criteria

- [ ] A single global cap controls locale work.
- [ ] Results remain in requested locale order.
- [ ] Started work settles before success or aggregate failure returns.
- [ ] CLI no longer calls immediate `process.exit(1)`.
- [ ] Failures identify locales without leaking content or credentials.
- [ ] Focused tests, typecheck, and full suite pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Plan 004 is incomplete, so output collisions are still possible.
- Plan 009 is incomplete, so partial successes cannot be persisted safely.
- The installed provider cannot safely run even two concurrent requests; report evidence and recommend a default of 1.
- Aggregate failure requires an undocumented breaking API change with no migration path.

## Maintenance notes

Provider/account limits vary; keep the default conservative. Future per-batch concurrency must share this same scheduler rather than multiplying the cap.
