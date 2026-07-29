# Plan 012: Remove unused direct tooling dependencies from the published package

> **Executor instructions**: Execute only after Plan 008's package gate is DONE. Run all gates and update the index.
>
> **Drift check (run first)**: `git diff --stat 2c2d1fd..HEAD -- package.json pnpm-lock.yaml vite.config.ts src tests/package-smoke.mjs`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/008-gate-distributable-cli.md`
- **Category**: tech-debt
- **Planned at**: commit `2c2d1fd`, 2026-07-29 (rebased onto completed Plan 008)

## Why this matters

`std-env` is listed as a production dependency without a source import. `vite-plugin-dts` is installed but never registered, while declarations are emitted directly by `tsc`. Removing them reduces install, lockfile, maintenance, and audit surface without changing runtime behavior.

## Current state

- `package.json:37` declares `std-env`.
- `vite.config.ts:20` lists `std-env` only as an external string; no source file imports it.
- `package.json:47` declares `vite-plugin-dts`, but `vite.config.ts:1-4` imports only Vite and a Node built-in.
- `package.json:23` emits declarations with:

```json
"build": "vite build && tsc --emitDeclarationOnly --declaration --declarationDir dist"
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Search | `rg -n "std-env|vite-plugin-dts" --glob '!pnpm-lock.yaml' .` | only expected manifest/config references before removal; none after |
| Build/package | `pnpm build && npm pack --dry-run --ignore-scripts` | exit 0; required dist files listed |
| Typecheck/tests | `pnpm typecheck && pnpm test` | both exit 0 |

## Scope

**In scope**:
- `package.json`
- `pnpm-lock.yaml`
- `vite.config.ts`

**Out of scope**:
- Upgrading any remaining package
- Migrating AI SDK/OpenRouter versions
- Replacing the deprecated Changesets changelog plugin
- Editing source to create artificial uses for these packages

## Git workflow

- Branch: `advisor/012-unused-dependencies`
- Commit example: `chore: remove unused tooling dependencies`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Reconfirm absence of use

Run the repository-wide search, including config and tests. Confirm `std-env` has no runtime import and `vite-plugin-dts` is not registered. If either gained a real use after the planned commit, stop.

**Verify**: `rg -n "std-env|vite-plugin-dts" --glob '!pnpm-lock.yaml' .` → only the baseline declaration/externalization sites.

### Step 2: Remove declarations and regenerate the lockfile

Use pnpm to remove both direct dependencies so `package.json` and `pnpm-lock.yaml` stay synchronized. Remove the obsolete `std-env` Rollup external entry. Do not manually rewrite unrelated lockfile sections.

**Verify**: `pnpm install --frozen-lockfile` → exit 0 after the regenerated lockfile is present.

### Step 3: Prove package equivalence

Run Plan 008's `pnpm test:package` build/package smoke gate, then typecheck and the full test suite. Inspect `git diff --stat` to ensure the lockfile change is limited to the removed dependency subtrees.

**Verify**: `pnpm test:package && pnpm typecheck && pnpm test` → all exit 0.

## Test plan

- No new behavioral unit test is required for dependency cleanup.
- Plan 008's build/import/CLI/pack smoke gate is the regression test for packaging and declarations.
- Use frozen install plus the full suite to detect lockfile or runtime drift.
- Verification: `pnpm install --frozen-lockfile && pnpm test:package && pnpm typecheck && pnpm test` → all exit 0.

## Done criteria

- [ ] Neither dependency remains in `package.json` or the direct lockfile importer.
- [ ] `vite.config.ts` no longer externalizes unused `std-env`.
- [ ] Frozen install, build, pack smoke, typecheck, and tests pass.
- [ ] No unrelated dependency version changed.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Plan 008 is not DONE.
- Search finds a live import/config use added since `2c2d1fd`.
- Pnpm changes unrelated direct dependency versions or requires a package-manager upgrade.
- Build/declaration output differs after removal.

## Maintenance notes

This plan intentionally does not mix cleanup with major-version upgrades. Review the lockfile diff for unrelated churn before accepting it.
