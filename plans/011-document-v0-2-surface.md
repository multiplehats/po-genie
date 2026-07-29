# Plan 011: Document the complete current CLI and programmatic API

> **Executor instructions**: Execute after behavior plans are complete so documentation describes reality. Run every verification and update the index.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- README.md package.json src/types.ts src/cli.ts CHANGELOG.md`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/003-preserve-gettext-plurals.md`, `plans/004-route-multi-locale-output.md`, `plans/008-gate-distributable-cli.md`, `plans/010-bound-locale-concurrency.md`
- **Category**: docs
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

Version 0.2 added WordPress `readme.txt` translation and mandatory usage/cost data, but the main description, feature list, CLI input reference, and API result example still describe the earlier PO-only surface. Users cannot reliably discover or integrate the released behavior from the README.

## Current state

- `package.json:4` describes only `.po` translation.
- `README.md:3-12` omits `readme.txt`.
- `README.md:65-77` says input is only `.po`/`.pot`.
- `README.md:137-167` omits `TranslateResult.usage`.
- `CHANGELOG.md:7-19` is the only focused description of readme translation.
- Documentation uses concise examples and option tables; preserve that style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build/help | `pnpm build && node dist/cli.js --help` | exit 0; documented flags appear |
| Typecheck/tests | `pnpm typecheck && pnpm test` | both exit 0 |
| Stale-text checks | `rg -n "readme\\.txt|usage|concurrency|Plural-Forms" README.md` | each implemented surface is documented |

## Scope

**In scope**:
- `README.md`
- `package.json` description only

**Out of scope**:
- Rewriting historical `CHANGELOG.md`
- Adding a contributor/agent guide
- Publishing docs or changing npm version
- Recommending model pricing without current authoritative verification

## Git workflow

- Branch: `advisor/011-docs`
- Commit example: `docs: document readme and usage APIs`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Correct product discovery

Update the package description, README introduction, and feature list to cover PO/POT and WordPress `readme.txt`. State plural support and structural-token validation only if Plans 003/007 are actually complete.

**Verify**: `rg -n "readme\\.txt" README.md package.json` → meaningful matches in both files.

### Step 2: Synchronize CLI reference and examples

Generate or inspect live `--help`, then update input types, output semantics for one versus multiple locales, batch validation, and concurrency if Plan 010 added it. Include a readme translation example and keep network/API-key setup accurate without including a real key.

**Verify**: `pnpm build && node dist/cli.js --help` → exit 0; compare output with the README and confirm every public flag is represented once.

### Step 3: Document the programmatic result contract

Show the complete `TranslateResult`, including `usage.promptTokens`, `completionTokens`, `totalTokens`, and optional `estimatedCostUsd`. Document aggregate/partial failure semantics from Plan 010 and checkpoint/resume behavior from Plan 009 if those are public.

Clarify that cost values are estimates for known model IDs and avoid presenting changeable prices as guarantees.

**Verify**: `pnpm typecheck && pnpm test` → both exit 0.

## Test plan

- Treat built CLI help/version and TypeScript interfaces as executable documentation sources.
- Check every public flag appears once and every `TranslateResult` field is described.
- Run the existing suite after documentation/package-description edits.
- Verification: `pnpm build && node dist/cli.js --help && pnpm typecheck && pnpm test` → all exit 0.

## Done criteria

- [ ] README and npm description mention both supported formats.
- [ ] CLI reference matches built help.
- [ ] Single/multi-locale output semantics are explicit.
- [ ] Programmatic result, usage, and failure contracts are documented.
- [ ] No real secret or credential value appears.
- [ ] Build, typecheck, and tests pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- A dependency plan is not DONE and its documented behavior remains unsettled.
- Built CLI help conflicts with source/type definitions.
- Updating docs would require claiming unverified current model prices or availability.

## Maintenance notes

Review public docs whenever `TranslateOptions`, `TranslateResult`, or CLI args change. Prefer smoke-tested help/version data over manually duplicated literals where practical.
