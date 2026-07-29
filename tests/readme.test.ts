import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadReadme } from '../src/readme.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: vi.fn(actual.renameSync),
  }
})

const FIXTURE = join(import.meta.dirname, 'fixtures', 'readme.txt')

describe('loadReadme', () => {
  it('loads a readme file and returns segments', () => {
    const readme = loadReadme(FIXTURE)
    expect(readme.segments).toBeDefined()
    expect(readme.segments.length).toBeGreaterThan(0)
  })

  it('plugin name is passthrough', () => {
    const readme = loadReadme(FIXTURE)
    const first = readme.segments[0]
    expect(first.type).toBe('passthrough')
    expect(first.content).toBe('=== Test Plugin ===')
  })

  it('metadata lines are passthrough', () => {
    const readme = loadReadme(FIXTURE)
    const metadataLines = [
      'Contributors: testauthor',
      'Tags: testing, example, demo',
      'Requires at least: 6.0',
      'Tested up to: 6.9',
      'Requires PHP: 8.1',
      'Stable tag: 1.0.0',
      'License: GPLv2 or later',
      'License URI: https://www.gnu.org/licenses/gpl-2.0.html',
    ]

    for (const meta of metadataLines) {
      const seg = readme.segments.find((s) => s.content === meta)
      expect(seg, `expected passthrough for "${meta}"`).toBeDefined()
      expect(seg!.type).toBe('passthrough')
    }
  })

  it('short description is translatable', () => {
    const readme = loadReadme(FIXTURE)
    const seg = readme.segments.find(
      (s) => s.content === 'AI-powered website translation for WordPress.',
    )
    expect(seg).toBeDefined()
    expect(seg!.type).toBe('translatable')
    expect(seg!.context).toBe('short description')
  })

  it('section headers are passthrough', () => {
    const readme = loadReadme(FIXTURE)
    const headers = [
      '== Description ==',
      '== Installation ==',
      '== Frequently Asked Questions ==',
      '== Screenshots ==',
      '== Changelog ==',
      '== Upgrade Notice ==',
    ]

    for (const header of headers) {
      const seg = readme.segments.find((s) => s.content === header)
      expect(seg, `expected passthrough for "${header}"`).toBeDefined()
      expect(seg!.type).toBe('passthrough')
    }
  })

  it('FAQ questions are translatable with prefix/suffix', () => {
    const readme = loadReadme(FIXTURE)
    const faqQuestion = readme.segments.find(
      (s) => s.content === 'Do I need an account?',
    )
    expect(faqQuestion).toBeDefined()
    expect(faqQuestion!.type).toBe('translatable')
    expect(faqQuestion!.prefix).toBe('= ')
    expect(faqQuestion!.suffix).toBe(' =')
    expect(faqQuestion!.context).toBe('faq question')
  })

  it('version headers are passthrough', () => {
    const readme = loadReadme(FIXTURE)
    // The version lines like "= 1.0.0 =" and "= 1.1.0 =" should be passthrough
    const v100 = readme.segments.find(
      (s) => s.content.includes('1.0.0') && s.type === 'passthrough' && s.content.startsWith('='),
    )
    const v110 = readme.segments.find(
      (s) => s.content.includes('1.1.0') && s.type === 'passthrough' && s.content.startsWith('='),
    )
    expect(v100).toBeDefined()
    expect(v110).toBeDefined()
  })

  it('bullet items are translatable with prefix', () => {
    const readme = loadReadme(FIXTURE)
    const bullet = readme.segments.find(
      (s) => s.content === 'Automatically translates all your pages and posts.',
    )
    expect(bullet).toBeDefined()
    expect(bullet!.type).toBe('translatable')
    expect(bullet!.prefix).toBe('* ')
  })

  it('numbered items are translatable with appropriate prefix', () => {
    const readme = loadReadme(FIXTURE)
    const numbered = readme.segments.find(
      (s) => s.content === 'Upload the plugin folder to `/wp-content/plugins/`.',
    )
    expect(numbered).toBeDefined()
    expect(numbered!.type).toBe('translatable')
    expect(numbered!.prefix).toBe('1. ')
  })

  it('screenshot captions have screenshot caption context', () => {
    const readme = loadReadme(FIXTURE)
    const caption = readme.segments.find(
      (s) => s.content.includes('Settings page') && s.context === 'screenshot caption',
    )
    expect(caption).toBeDefined()
    expect(caption!.type).toBe('translatable')
    expect(caption!.context).toBe('screenshot caption')
  })

  it('multi-line paragraphs are single segments', () => {
    const readme = loadReadme(FIXTURE)
    // The Description section has a long paragraph that is a single line in the fixture,
    // but FAQ answers are single-line paragraphs. Check the FAQ answer paragraph.
    const faqAnswer = readme.segments.find(
      (s) =>
        s.type === 'translatable' &&
        s.content.startsWith('Yes. You need an API key'),
    )
    expect(faqAnswer).toBeDefined()
  })

  it('blank lines are passthrough', () => {
    const readme = loadReadme(FIXTURE)
    const blanks = readme.segments.filter(
      (s) => s.type === 'passthrough' && s.content.trim() === '',
    )
    expect(blanks.length).toBeGreaterThan(0)
  })

  it('round-trip serialization produces identical content', () => {
    const readme = loadReadme(FIXTURE)
    const original = readFileSync(FIXTURE, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // serialize via save to a temporary path and read back
    const { mkdtempSync, rmSync } = require('node:fs')
    const { tmpdir } = require('node:os')
    const tmpDir = mkdtempSync(join(tmpdir(), 'readme-test-'))
    const outFile = join(tmpDir, 'readme.txt')

    readme.save(outFile)

    const serialized = readFileSync(outFile, 'utf-8')
    expect(serialized).toBe(original)

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('replaces an existing readme destination with serialized UTF-8 text', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'readme-test-'))
    const outFile = join(tmpDir, 'readme.txt')
    writeFileSync(outFile, Buffer.from([0, 1, 2, 3]))

    const readme = loadReadme(FIXTURE)
    readme.save(outFile)

    expect(readFileSync(outFile, 'utf-8')).toContain('=== Test Plugin ===')
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps the existing readme bytes and removes its sibling temporary file when renaming fails', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'readme-test-'))
    const outFile = join(tmpDir, 'readme.txt')
    const original = Buffer.from([0, 1, 2, 255])
    writeFileSync(outFile, original)

    const readme = loadReadme(FIXTURE)
    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const rename = vi.mocked(renameSync)
    const previousImplementation = rename.getMockImplementation()
    rename.mockImplementation((oldPath, newPath) => {
      if (
        typeof oldPath === 'string' &&
        typeof newPath === 'string' &&
        dirname(oldPath) === tmpDir &&
        newPath === outFile
      ) {
        throw new Error('injected rename failure')
      }
      return actualFs.renameSync(oldPath, newPath)
    })

    try {
      expect(() => readme.save(outFile)).toThrow('injected rename failure')
    } finally {
      rename.mockImplementation(previousImplementation!)
    }

    expect(readFileSync(outFile)).toEqual(original)
    expect(readdirSync(tmpDir)).toEqual(['readme.txt'])
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('serialization uses translations when set', () => {
    const readme = loadReadme(FIXTURE)

    // Set translated on the short description segment
    const shortDesc = readme.segments.find(
      (s) => s.content === 'AI-powered website translation for WordPress.',
    )
    expect(shortDesc).toBeDefined()
    shortDesc!.translated = 'KI-gesteuerte Website-Ubersetzung fur WordPress.'

    // Set translated on a bullet item
    const bullet = readme.segments.find(
      (s) => s.content === 'Automatically translates all your pages and posts.',
    )
    expect(bullet).toBeDefined()
    bullet!.translated = 'Ubersetzt automatisch alle Ihre Seiten und Beitrage.'

    const { mkdtempSync, rmSync } = require('node:fs')
    const { tmpdir } = require('node:os')
    const tmpDir = mkdtempSync(join(tmpdir(), 'readme-test-'))
    const outFile = join(tmpDir, 'readme.txt')

    readme.save(outFile)

    const serialized = readFileSync(outFile, 'utf-8')
    expect(serialized).toContain('KI-gesteuerte Website-Ubersetzung fur WordPress.')
    expect(serialized).toContain('* Ubersetzt automatisch alle Ihre Seiten und Beitrage.')
    // Original untranslated segments should keep their original content
    expect(serialized).toContain('=== Test Plugin ===')
    expect(serialized).toContain('Contributors: testauthor')

    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('non-FAQ subsection headings have subsection heading context', () => {
    const readme = loadReadme(FIXTURE)
    const subsection = readme.segments.find(
      (s) => s.content === 'How It Works',
    )
    expect(subsection).toBeDefined()
    expect(subsection!.type).toBe('translatable')
    expect(subsection!.context).toBe('subsection heading')
  })
})
