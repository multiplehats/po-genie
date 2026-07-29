# Plan 003: Translate gettext plural entries without truncating any form

> **Executor instructions**: Execute only after Plan 002 is DONE. Run each verification gate and update `plans/README.md` on completion.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/po.ts src/gettext-parser.d.ts src/translate.ts src/types.ts tests/po.test.ts tests/translate.test.ts tests/fixtures`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-set-po-locale-metadata.md`
- **Category**: bug
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

Plural entries contain `msgid_plural` and multiple `msgstr[n]` values. The current model exposes only `msgstr[0]`, decides missingness from that slot, then replaces the entire array with one value. Normal plural catalogs therefore lose data or remain partly untranslated.

## Current state

`src/po.ts:29-33` currently flattens the entry:

```ts
entries.push({
  msgid: item.msgid,
  msgctxt: item.msgctxt,
  msgstr: item.msgstr[0] ?? '',
  _item: item,
})
```

`src/translate.ts:270-272` filters on the flattened string, and `src/translate.ts:308-312` truncates:

```ts
const toTranslate = onlyMissing
  ? po.entries.filter((e) => !e.msgstr)
  : po.entries

toTranslate[entryIndex]._item.msgstr = [restored]
```

The custom gettext declaration omits `msgid_plural`; tests contain no plural fixture.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/po.test.ts tests/translate.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/gettext-parser.d.ts`
- `src/po.ts`
- `src/translate.ts`
- `src/types.ts` only if result counts need documented clarification
- `tests/po.test.ts`
- `tests/translate.test.ts`
- A new plural fixture under `tests/fixtures/` if useful

**Out of scope**:
- Changing singular-entry output
- Locale metadata lookup (Plan 002 owns it)
- Gettext context prompts (Plan 006)
- Retrying malformed model responses (Plan 005)

## Git workflow

- Branch: `advisor/003-gettext-plurals`
- Commit example: `fix: preserve gettext plural translations`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Model plural data without breaking singular access accidentally

Add `msgid_plural?: string` to the parser declaration. Change `POEntry` so callers and translation logic can inspect the complete `msgstr` array. Prefer a clearly named array field such as `msgstrs`; if retaining singular `msgstr` for compatibility, document it as slot 0 and make the array authoritative.

Use Plan 002's locale metadata/rule helper to obtain the required cardinal form count.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Build explicit plural translation jobs

Represent each missing target form as a job tied to `(entry, formIndex)`. Preserve existing non-empty forms when `onlyMissing` is true; when false, replace all required forms. Supply both singular and plural source text plus the target form index/rule context to the model as structured metadata, never as text that can leak into output.

Apply results back to their exact `msgstr[formIndex]`. Never assign a one-element array to a plural item.

Define `translated` consistently: count catalog entries completed, not internal plural slots, unless the public documentation and tests are deliberately updated.

**Verify**: `pnpm exec vitest run tests/translate.test.ts` → all pass.

### Step 3: Add plural regression coverage

Cover:

- two-form untranslated plural,
- three-form untranslated plural,
- partially translated plural with `onlyMissing: true`,
- full replacement with `onlyMissing: false`,
- singular entries unchanged,
- model response count mismatch for plural jobs.

Reparse saved files and assert all `msgstr[n]` slots exist and existing non-empty slots survive.

**Verify**: `pnpm exec vitest run tests/po.test.ts tests/translate.test.ts` → all pass.

## Test plan

- Follow the literal PO fixtures and mocked-provider pattern in `tests/translate.test.ts`.
- Add two-form, three-form, partially complete, full-retranslation, singular-control, and malformed-response cases.
- Reparse saved files and assert exact `msgstr[n]` arrays rather than string containment alone.
- Verification: `pnpm exec vitest run tests/po.test.ts tests/translate.test.ts` → all pass.

## Done criteria

- [ ] No production assignment truncates a plural `msgstr` array.
- [ ] Required forms match the target locale rule from Plan 002.
- [ ] Partial plural translations preserve completed slots.
- [ ] Singular behavior and public counts are explicitly tested.
- [ ] Focused tests, typecheck, and full suite pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Plan 002 is not complete or does not expose an authoritative target form count.
- The parser's live object shape differs from `msgid_plural` plus `msgstr[]`.
- Correct behavior requires guessing the relationship between gettext indexes and locale plural forms.
- The change would silently break a documented public `POEntry` contract without a migration decision.

## Maintenance notes

Future glossary/context work must treat plural forms as related translations, not independent strings. Reviewers should inspect saved fixture text, not only in-memory mocks.
