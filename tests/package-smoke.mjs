import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

function run(command, args, env) {
  const outputDir = mkdtempSync(join(tmpdir(), 'po-genie-command-'))
  const outputPath = join(outputDir, 'output')
  const output = openSync(outputPath, 'w')
  const result = spawnSync(command, args, {
    cwd: root,
    env: { PATH: process.env.PATH, ...env },
    stdio: ['ignore', output, output],
  })
  closeSync(output)
  const text = readFileSync(outputPath, 'utf8')
  rmSync(outputDir, { recursive: true, force: true })
  assert.ifError(result.error)
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${text}`)
  return text
}

const npmCache = mkdtempSync(join(tmpdir(), 'po-genie-npm-cache-'))

try {
  await import('../dist/index.js')
  run('node', ['dist/cli.js', '--help'])
  assert.equal(run('node', ['dist/cli.js', '--version']).trim(), packageJson.version)

  const packed = JSON.parse(
    run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', '--loglevel=error'], {
      npm_config_cache: npmCache,
    }),
  )
  const files = packed[0].files.map(({ path }) => path)
  assert.ok(files.includes('dist/index.js'))
  assert.ok(files.includes('dist/index.d.ts'))
  assert.ok(files.includes('dist/cli.js'))
  assert.ok(readFileSync(resolve(root, 'dist/cli.js'), 'utf8').startsWith('#!/usr/bin/env node'))
} finally {
  rmSync(npmCache, { recursive: true, force: true })
}
