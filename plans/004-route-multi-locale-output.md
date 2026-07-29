# Plan 004: Route multi-locale output to distinct deterministic files

> **Executor instructions**: Follow this plan exactly and update its index row when done.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/translate.ts src/types.ts src/cli.ts tests/translate.test.ts tests/translate-readme.test.ts README.md`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

The public type says `output` is a directory for multiple locales, but each locale currently receives the same explicit path. A directory fails after paid calls; a file is concurrently overwritten, leaving nondeterministic data loss. Routing and collision validation must finish before any model request starts.

## Current state

- `src/types.ts:6-9`: “When multiple locales are given, this is used as a directory.”
- `src/translate.ts:86-88`: `if (output) return resolve(output)`.
- `src/translate.ts:338-340` passes unchanged options into every locale:

```ts
const locales = Array.isArray(options.locale) ? options.locale : [options.locale]
return Promise.all(locales.map((locale) => translateFile({ ...options, locale })))
```

- No test invokes the public multi-locale `translate()` wrapper.

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
- `src/cli.ts` only for error presentation or help text
- `tests/translate.test.ts`
- `tests/translate-readme.test.ts`

**Out of scope**:
- Concurrency/failure aggregation (Plan 010)
- Creating arbitrary missing parent directories
- Changing single-locale explicit-file behavior
- Broad README refresh (Plan 011)

## Git workflow

- Branch: `advisor/004-multi-locale-output`
- Commit example: `fix: route locale outputs to distinct files`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Normalize and validate locale jobs

At `translate()` entry, normalize locale strings, reject empty or duplicate locales, and decide output semantics before launching jobs. For more than one locale, treat an explicit `output` as a directory and derive each default locale-suffixed basename inside it. Reject path collisions before creating a provider or reading/translating content.

Preserve current single-locale behavior where `output` is an exact file path.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Separate path planning from execution

Refactor output resolution into pure functions that can be tested without network calls. Pass the final distinct file path into each `translateFile` job. Support both `.po`/`.pot` and `readme.txt` naming conventions.

**Verify**: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → all pass.

### Step 3: Add advertised multi-locale tests

Call `translate()` with at least two locales and mocked AI output. Assert stable result order, unique outputs, correct contents, output-directory behavior, duplicate/empty locale rejection, and no paid calls when routing validation fails.

**Verify**: `pnpm test` → all tests pass.

## Test plan

- Extend both translation suites using their temp-directory and provider-mock patterns.
- Cover PO/readme defaults, explicit multi-locale directory, single-locale exact file, duplicate locale, empty locale, and stable result order.
- Assert invalid routing makes zero `generateObject` calls.
- Verification: `pnpm exec vitest run tests/translate.test.ts tests/translate-readme.test.ts` → all pass.

## Done criteria

- [ ] Multi-locale jobs cannot resolve to the same output.
- [ ] Explicit multi-locale output behaves as the documented directory.
- [ ] Single-locale explicit output remains an exact path.
- [ ] Validation precedes every `generateObject` call.
- [ ] Typecheck and all tests pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Existing consumers are proven to rely on one shared output file for multiple locales.
- Output semantics changed on the branch after `fa5fd1d`.
- Collision-free routing requires changing the input filename convention beyond this plan.

## Maintenance notes

Plan 010 will replace `Promise.all`; it must reuse this path-planning boundary and preserve stable result ordering.
