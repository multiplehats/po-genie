# Plan 008: Build and smoke-test the published CLI in CI with one authoritative version

> **Executor instructions**: Follow each step and verification command. Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat fa5fd1d..HEAD -- package.json vite.config.ts src/cli.ts src .github/workflows/ci.yml tests`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `fa5fd1d`, 2026-07-29

## Why this matters

Consumers receive only generated `dist` JavaScript, declarations, and the CLI entrypoint, yet pull-request CI runs neither the build nor a package smoke test. The active mismatch—package `0.2.0`, CLI `0.1.0`—shows this gap already permits user-visible release drift.

## Current state

- `package.json:3`: `"version": "0.2.0"`.
- `src/cli.ts:6-10` hard-codes `version: '0.1.0'`.
- `package.json:6-20` publishes only `dist` entrypoints.
- `.github/workflows/ci.yml:21-46` runs typecheck and tests, but not `pnpm build`.
- Vite already controls CLI bundling/shebang at `vite.config.ts:5-34`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build | `pnpm build` | exit 0; `dist/index.js`, `dist/cli.js`, declarations exist |
| CLI smoke | `node dist/cli.js --version` | prints the version in `package.json` |
| Pack manifest | `npm pack --dry-run --ignore-scripts` | exit 0; package contains required `dist` files |
| Typecheck/tests | `pnpm typecheck && pnpm test` | both exit 0 |

## Scope

**In scope**:
- `src/cli.ts`
- `vite.config.ts`
- `package.json`
- `.github/workflows/ci.yml`
- a new CLI/build smoke test under `tests/` if needed
- a small declaration file under `src/` if build-time version injection requires it

**Out of scope**:
- Release workflow publishing permissions
- Changing package version manually
- CLI output redesign
- Dependency removal (Plan 012)

## Git workflow

- Branch: `advisor/008-package-ci`
- Commit example: `ci: verify distributable CLI`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Single-source the version at build time

Remove the literal CLI version. Inject or import `package.json`'s version through a Node 20/ESM-compatible build-time mechanism. Prefer Vite `define` or another compile-time value over a runtime filesystem lookup that can fail in installed packages.

Add a type declaration if a build constant is used. Keep `src/cli.ts` directly runnable under the existing test/build toolchain.

**Verify**: `pnpm build && node dist/cli.js --version` → prints exactly `0.2.0` at this baseline.

### Step 2: Add package smoke checks

Add an automated test or script that verifies:

- root import loads from `dist/index.js`,
- `dist/cli.js --help` exits 0,
- CLI version equals `package.json`,
- the packed manifest includes JS, declarations, and CLI.

Do not make a real translation request.

**Verify**: `pnpm build && npm pack --dry-run --ignore-scripts` → expected files listed, exit 0.

### Step 3: Gate pull requests

Add a CI job/step after frozen install that runs the build and smoke checks. Avoid a third redundant install if the workflow can safely share or consolidate jobs; clarity is more important than premature optimization.

**Verify**: `pnpm typecheck && pnpm test && pnpm build` → all exit 0; workflow contains the same build/smoke commands.

## Test plan

- Add a network-free built-artifact smoke script or Vitest subprocess test.
- Assert root ESM import, CLI help exit, package/CLI version equality, shebang, declarations, and pack manifest contents.
- Do not require shell-specific behavior inside the test.
- Verification: `pnpm build && node dist/cli.js --version && npm pack --dry-run --ignore-scripts` → all exit 0.

## Done criteria

- [ ] CLI version comes from `package.json`.
- [ ] Build, root import, CLI help/version, and pack contents are checked.
- [ ] Pull-request CI runs the distributable gate.
- [ ] Typecheck and full tests pass.
- [ ] Only in-scope files plus plan index changed.

## STOP conditions

- Version injection requires runtime access outside the published package.
- `npm pack --dry-run --ignore-scripts` does not inspect the intended local package on the installed npm version; replace it only with a verified equivalent.
- CI changes require release credentials.

## Maintenance notes

Keep the smoke test cheap and network-free. Plan 012 depends on this gate so removed tooling is proven unnecessary.
