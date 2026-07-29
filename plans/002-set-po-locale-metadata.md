# Plan 002: Write authoritative target-locale metadata into generated PO catalogs

> **Executor instructions**: Follow every step and verification gate. Stop on a listed STOP condition; do not invent plural formulas. Update this plan's row in `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- src/po.ts src/translate.ts src/gettext-parser.d.ts tests/po.test.ts tests/translate.test.ts package.json pnpm-lock.yaml`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

The target locale is known, but saved catalogs retain the POT's blank metadata or a source PO's stale `Language` and `Plural-Forms`. Runtime gettext plural selection and downstream tools rely on these headers. The implementation must use an authoritative locale-to-gettext-rule source; guessed formulas are worse than missing metadata.

## Current state

- `src/po.ts:18-20` parses the catalog and `src/po.ts:38-43` compiles it unchanged.
- `src/translate.ts:263-268` knows `locale` but calls `loadPO(input)` without applying it.
- The local declaration models `headers: Record<string, string>` at `src/gettext-parser.d.ts:16-19`.
- Test style: construct literal PO text in a temp directory, save, then inspect or reparse it (`tests/po.test.ts:64-92`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `pnpm exec vitest run tests/po.test.ts tests/translate.test.ts` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Full suite | `pnpm test` | all tests pass |

## Scope

**In scope**:
- `src/po.ts`
- `src/translate.ts`
- `src/gettext-parser.d.ts`
- `tests/po.test.ts`
- `tests/translate.test.ts`
- `package.json` and `pnpm-lock.yaml` only if an authoritative plural-rule dependency is necessary

**Out of scope**:
- Translating plural `msgstr[n]` values (Plan 003)
- Rewriting unrelated headers such as project/version fields
- Supporting ordinal plural rules
- Hand-writing an incomplete locale table

## Git workflow

- Branch: `advisor/002-po-locale-metadata`
- Commit example: `fix: set target locale metadata in PO output`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define the metadata API

Extend `POFile` with a method such as `setLocale(locale: string): void`, keeping parsed internals private. It must set `Language` to the normalized target locale and set a syntactically valid GNU gettext `Plural-Forms` value for that locale.

Select a maintained data source that explicitly exposes GNU gettext rules or enough authoritative data to produce them. Record the source in a code comment. Do not derive a gettext expression by guessing from a few `Intl.PluralRules` samples.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Apply metadata before every PO save

In the PO branch of `translateFile`, call the new method immediately after `loadPO(input)` and before either the zero-work save or translated save. Preserve all unrelated source headers.

Normalize locale separators consistently with `localeToLanguageName`; do not silently change the locale's language/region meaning.

**Verify**: `pnpm exec vitest run tests/translate.test.ts` → all pass.

### Step 3: Add representative header tests

Test at least:

- a POT with empty `Language`,
- a PO with stale source `Language`,
- a two-form locale (`nl_NL`),
- a three-form locale (for example `pl_PL`),
- a locale unsupported by the chosen rule source.

For supported locales, reparse the saved output and assert exact target `Language`, valid `nplurals`, and preservation of unrelated headers. Unsupported locale behavior must be a clear pre-save error, not a guessed rule.

**Verify**: `pnpm exec vitest run tests/po.test.ts tests/translate.test.ts` → all pass.

## Test plan

- Model new save tests after `tests/po.test.ts:64-92`.
- Assert metadata in both the zero-translations path (`src/translate.ts:279-281`) and normal translated path.
- No network or real AI call is needed.

## Done criteria

- [ ] Generated PO files carry the requested `Language`.
- [ ] Supported locales carry authoritative GNU gettext `Plural-Forms`.
- [ ] Unrelated headers remain unchanged.
- [ ] Unknown rules fail before output is replaced.
- [ ] Focused tests, `pnpm typecheck`, and `pnpm test` pass.
- [ ] Only in-scope files plus the plan index changed.

## STOP conditions

- No maintained authoritative GNU gettext plural-rule source can be found.
- The chosen dependency requires a runtime or license incompatible with this MIT Node 20 package.
- Locale metadata can only be implemented by bundling a hand-maintained partial table.
- An in-scope excerpt has materially drifted.

## Maintenance notes

Plan 003 consumes the plural-count decision introduced here. Review dependency size and ESM/Node 20 compatibility, and keep plural-rule data upgrades deliberate.
