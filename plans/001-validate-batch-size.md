# Plan 001: Reject invalid batch sizes before any translation work starts

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, report it rather than improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/translate.ts src/cli.ts tests/translate.test.ts tests/translate-readme.test.ts`
> If an in-scope file changed, compare the excerpts below with live code. Stop if the batching contract has materially changed.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

`batchSize` controls a loop increment. Zero or negative values never advance the loop and eventually exhaust memory; `NaN` and fractional programmatic values create empty or malformed batches. Validation must happen before opening files, creating the model client, or making paid calls.

## Current state

- `src/cli.ts:50-53` parses arbitrary text without validation:

```ts
const batchSize = args['batch-size'] ? parseInt(args['batch-size'], 10) : undefined
```

- `src/translate.ts:287-293` and `src/translate.ts:167-173` increment directly by `batchSize`:

```ts
for (let i = 0; i < extracted.length; i += batchSize) {
  batches.push(
    Array.from({ length: Math.min(batchSize, extracted.length - i) }, (_, j) => i + j),
  )
}
```

- Match existing conventions: plain `Error` instances with actionable messages (`src/translate.ts:133-138`), strict TypeScript, single quotes, no semicolons, and Vitest mocks/temp directories from `tests/translate.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` | all focused tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/translate.ts`
- `src/cli.ts`
- `tests/translate.test.ts`
- `tests/translate-readme.test.ts`

**Out of scope**:
- Changing the default batch size of 40
- Adding concurrency, retry, or budget controls
- Making real OpenRouter requests
- Changing CLI flag names

## Git workflow

- Branch: `advisor/001-validate-batch-size`
- Use conventional commits, e.g. `fix: validate translation batch size`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add one shared validation boundary

Add a small validator in `src/translate.ts` that accepts only finite positive integers. Call it at the start of `translateFile`, before the extension branch, so PO and readme paths share the exact rule. The default value remains 40. Error text must identify `batchSize` and say it must be a positive integer.

Do not silently clamp, round, or fall back: invalid programmatic input is a caller error.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Make CLI parsing reject non-integer text

Keep `--batch-size` as a string argument, but ensure text such as `abc`, `2.5`, `0`, and `-1` reaches the same actionable error instead of being partially accepted by `parseInt`. A small exported pure parser is acceptable only if it enables direct testing without executing `runMain`.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Add regression tests

In both translation suites, add table-driven cases for `0`, `-1`, `NaN`, `1.5`, and positive integer `1`. Assert invalid values reject before `generateObject` is called and valid values preserve current batching.

**Verify**: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → all pass.

## Test plan

- Follow `tests/translate.test.ts:206-220` for valid batch behavior.
- Cover both file formats because they have separate batching loops.
- Assert the stable error substring `batchSize must be a positive integer`.
- Never use a real API key or network request.

## Done criteria

- [ ] Invalid values reject promptly; no loop can run with an invalid increment.
- [ ] Validation occurs before `generateObject`.
- [ ] `pnpm typecheck`, focused tests, and `pnpm test` exit 0.
- [ ] Only in-scope files plus `plans/README.md` changed.
- [ ] The plan index status is updated.

## STOP conditions

- `batchSize` has become a non-number public type or batching moved to a shared scheduler.
- Correct validation would require changing the public default.
- A focused verification fails twice after a reasonable correction.

## Maintenance notes

Keep this validator as the single entry boundary if future concurrency or token-budget options also depend on batch size. Reviewers should reject silent coercion because it hides configuration mistakes.
