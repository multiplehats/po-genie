import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  version: string
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const childEnv = { PATH: process.env.PATH, ...env }
  const outputDir = mkdtempSync(join(tmpdir(), 'po-genie-command-'))
  const outputPath = join(outputDir, 'output')
  const output = openSync(outputPath, 'w')
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: childEnv,
    stdio: ['ignore', output, output],
  })
  closeSync(output)
  const text = readFileSync(outputPath, 'utf8')
  rmSync(outputDir, { recursive: true, force: true })
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  return text
}

const npmCache = mkdtempSync(join(tmpdir(), 'po-genie-npm-cache-'))

afterAll(() => rmSync(npmCache, { recursive: true, force: true }))

describe('published package', () => {
  it('exposes a loadable root module', async () => {
    await expect(import('../dist/index.js')).resolves.toBeTypeOf('object')
  })

  it('runs the bundled CLI help', () => {
    run('node', ['dist/cli.js', '--help'])
  })

  it('reports the package version from the bundled CLI', () => {
    expect(run('node', ['dist/cli.js', '--version']).trim()).toBe(packageJson.version)
  })

  it('packs JavaScript, declarations, and the CLI', () => {
    const packed = JSON.parse(
      run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--loglevel=error'], {
        ...process.env,
        npm_config_cache: npmCache,
      }),
    ) as Array<{ files: Array<{ path: string }> }>
    const files = packed[0].files.map(({ path }) => path)

    expect(files).toContain('dist/index.js')
    expect(files).toContain('dist/index.d.ts')
    expect(files).toContain('dist/cli.js')
  })

  it('keeps the CLI executable after bundling', () => {
    const cli = readFileSync(resolve(root, 'dist/cli.js'), 'utf8')
    expect(cli.startsWith('#!/usr/bin/env node')).toBe(true)
  })
})
