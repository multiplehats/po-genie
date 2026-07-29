# Plan 007: Reject translations that alter protected runtime or formatting tokens

> **Executor instructions**: Follow every step and verification gate. Do not weaken validation merely to make a mocked response pass. Update the plan index when done.
>
> **Drift check (run first)**: `git diff --stat cdc503f..HEAD -- src/variables.ts src/translate.ts src/readme.ts tests/variables.test.ts tests/translate.test.ts tests/translate-readme.test.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/005-separate-readme-context.md`
- **Category**: bug
- **Planned at**: commit `cdc503f`, 2026-07-29 (rebased onto completed Plan 005)

## Why this matters

The package promises variables survive translation, but it only restores tokens that the model happens to return. Missing, duplicated, altered, or invented tokens are accepted and saved. Readme URLs, inline code, HTML tags, and Markdown link destinations are likewise protected only by prompt wording.

## Current state

`src/variables.ts:52-55` performs best-effort restoration:

```ts
return translated.replace(/\[VAR_(\d+)\]/g, (token, i) => {
  return vars[parseInt(i, 10)] ?? token
})
```

`src/translate.ts:73-77` validates only response array length. Both assignment paths restore and save without structural checks (`src/translate.ts:205-221`, `src/translate.ts:308-324`). Existing tests cover only cooperative model output (`tests/variables.test.ts:100-130`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/variables.test.ts tests/translate.test.ts tests/translate-readme.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/variables.ts`
- `src/translate.ts`
- `src/readme.ts` only if immutable-fragment extraction belongs beside parsing
- `tests/variables.test.ts`
- `tests/translate.test.ts`
- `tests/translate-readme.test.ts`

**Out of scope**:
- Automatic retries/checkpoints (Plan 009)
- General translation-quality scoring
- Sanitizing arbitrary HTML
- Changing supported runtime placeholder syntaxes beyond a directly tested omission

## Git workflow

- Branch: `advisor/007-output-integrity`
- Commit example: `fix: validate protected translation tokens`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make token integrity machine-checkable

Add a pure validation function that compares the exact token multiset in the source template with the model response before restoration. It must allow reordering but reject missing, duplicated, altered, and unknown tokens. Error messages should identify locale/batch/item index and token IDs, not reproduce full source text.

Retain `restoreVariables` as restoration only; validation must be an explicit required step at both call sites.

**Verify**: `pnpm exec vitest run tests/variables.test.ts` → all tests pass.

### Step 2: Protect immutable readme/source fragments

Before model submission, tokenize immutable fragments that the prompts already promise to preserve: URLs, Markdown link destinations, inline code spans, and HTML tags. Use a distinct stable token namespace or a unified protected-token abstraction with collision-safe IDs.

Do not protect natural-language link labels or ordinary punctuation. Preserve exact fragment multiplicity and restore only after validation succeeds.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Enforce validation before mutation

Validate every returned string before mutating any entry in that batch. If one item fails, reject the batch and leave all its target entries untouched. Apply this to PO singular/plural jobs and readme segments.

**Verify**: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → all pass.

### Step 4: Add hostile-response regression tests

Cover omitted, duplicated, renamed, and invented tokens; legitimate reordering; repeated source placeholders; altered URL; changed inline code; changed HTML tag; and a valid translated Markdown label with unchanged destination. Assert invalid batches do not write output or report progress.

**Verify**: `pnpm test` → all tests pass.

## Test plan

- Put pure extraction/multiset cases in `tests/variables.test.ts` and save/mutation behavior in both translation suites.
- Cover omitted, duplicate, altered, invented, reordered, and repeated tokens plus URL, inline-code, HTML-tag, and Markdown-destination preservation.
- Assert invalid output produces no progress callback and no final/checkpoint output.
- Verification: `pnpm exec vitest run tests/variables.test.ts tests/translate.test.ts tests/translate-readme.test.ts` → all pass.

## Done criteria

- [ ] Exact protected-token multiplicity is validated before restoration.
- [ ] Invalid responses never mutate/save the affected batch.
- [ ] Placeholder reordering remains valid.
- [ ] URLs, inline code, HTML tags, and Markdown destinations round-trip exactly.
- [ ] Focused tests, typecheck, and full suite pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Plan 005 is incomplete and readme context remains embedded in source text.
- A proposed validator rejects legitimate target-language text rather than structural tokens.
- Correct HTML/Markdown handling would require building a general sanitizer/parser outside this scope.
- Error reporting would expose full potentially sensitive source strings.

## Maintenance notes

Any new placeholder syntax must be added to extraction and integrity tests together. Plan 009 may retry integrity failures, but it must never checkpoint a response that failed these checks.
