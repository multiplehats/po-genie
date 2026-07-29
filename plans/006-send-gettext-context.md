# Plan 006: Supply gettext message context as structured translation metadata

> **Executor instructions**: Follow all steps and update the index row when complete.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/po.ts src/translate.ts tests/translate.test.ts tests/fixtures`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

Gettext uses `msgctxt` to distinguish identical source strings used in different meanings, such as a noun versus a verb. The parser retains this data but the request contains only `msgid`, so the model cannot disambiguate translations.

## Current state

- `src/po.ts:29-33` stores `msgctxt`.
- `src/translate.ts:284-285` extracts only `entry.msgid`.
- `translateBatch` currently accepts `strings: string[]` and sends `JSON.stringify(strings)` at `src/translate.ts:57-70`.
- Tests mock `generateObject` and can inspect its `messages` argument (`tests/translate.test.ts:73-81`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/translate.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/translate.ts`
- `src/po.ts` only if an internal request-item type belongs there
- `tests/translate.test.ts`
- a context fixture under `tests/fixtures/` if useful

**Out of scope**:
- Altering the serialized `msgctxt`
- Readme context transport (Plan 005)
- Translator/extracted comments
- Glossary or translation-memory features

## Git workflow

- Branch: `advisor/006-gettext-context`
- Commit example: `fix: pass gettext context to translations`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Introduce a structured request item

Change the PO batch input from bare strings to objects containing a protected source template and optional `msgctxt`. Tell the model context is metadata for disambiguation and must not appear in output. Keep response ordering and the string-array schema unchanged.

Do not concatenate context into source text or later strip it heuristically.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Add context-specific tests

Construct a PO with the same `msgid` under two different `msgctxt` values. Inspect the mocked request to assert both contexts are present and paired with the correct item, then return distinct translations and assert both serialize under their original contexts.

Also test an entry without `msgctxt`.

**Verify**: `pnpm exec vitest run tests/translate.test.ts` → all pass.

## Test plan

- Add a literal PO containing duplicate `msgid` values under two contexts.
- Inspect the outbound JSON, return distinct mocked translations, and reparse the saved PO.
- Include a context-free control and assert metadata never appears in `msgstr`.
- Verification: `pnpm exec vitest run tests/translate.test.ts` → all pass.

## Done criteria

- [ ] Every PO request item retains its optional `msgctxt`.
- [ ] Context never becomes part of saved `msgstr`.
- [ ] Same-source/different-context entries can receive distinct translations.
- [ ] Focused tests, typecheck, and full suite pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Plan 003 changed the request-job representation and its live shape cannot safely carry context.
- Correct implementation would change catalog context keys.
- Request/schema drift makes response-to-entry ordering ambiguous.

## Maintenance notes

When plural support is present, attach context to the parent plural entry and every derived form job. Future translator-comment support should reuse the metadata channel rather than source prefixes.
