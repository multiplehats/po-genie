import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadPO, localeToLanguageName } from '../src/po.js'

const SIMPLE_PO = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: nl_NL\\n"

msgid "Save settings"
msgstr "Instellingen opslaan"

msgid "Cancel"
msgstr ""

msgid "Loading..."
msgstr "Laden..."
`.trim()

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'po-genie-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadPO', () => {
  it('parses all entries from a .po file', () => {
    const file = join(tmpDir, 'test.po')
    writeFileSync(file, SIMPLE_PO)

    const po = loadPO(file)
    expect(po.entries).toHaveLength(3)
  })

  it('reads msgid and msgstr correctly', () => {
    const file = join(tmpDir, 'test.po')
    writeFileSync(file, SIMPLE_PO)

    const po = loadPO(file)
    const save = po.entries.find((e) => e.msgid === 'Save settings')

    expect(save).toBeDefined()
    expect(save!.msgstr).toBe('Instellingen opslaan')
  })

  it('exposes empty msgstr as empty string', () => {
    const file = join(tmpDir, 'test.po')
    writeFileSync(file, SIMPLE_PO)

    const po = loadPO(file)
    const cancel = po.entries.find((e) => e.msgid === 'Cancel')

    expect(cancel).toBeDefined()
    expect(cancel!.msgstr).toBe('')
  })

  it('saves mutations back to file via _item reference', () => {
    const file = join(tmpDir, 'test.po')
    const out = join(tmpDir, 'out.po')
    writeFileSync(file, SIMPLE_PO)

    const po = loadPO(file)
    const cancel = po.entries.find((e) => e.msgid === 'Cancel')!
    cancel._item.msgstr = ['Annuleren']

    po.save(out)

    const saved = readFileSync(out, 'utf-8')
    expect(saved).toContain('msgstr "Annuleren"')
  })

  it('save() writes back in-place when output path equals input path', () => {
    const file = join(tmpDir, 'test.po')
    writeFileSync(file, SIMPLE_PO)

    const po = loadPO(file)
    const cancel = po.entries.find((e) => e.msgid === 'Cancel')!
    cancel._item.msgstr = ['Annuleren']
    po.save(file)

    const saved = readFileSync(file, 'utf-8')
    expect(saved).toContain('msgstr "Annuleren"')
    // Previously translated strings must be preserved
    expect(saved).toContain('msgstr "Instellingen opslaan"')
  })

  it('throws for a non-existent file', () => {
    expect(() => loadPO(join(tmpDir, 'missing.po'))).toThrow()
  })
})

describe('localeToLanguageName', () => {
  it('converts nl_NL to a Dutch language name', () => {
    const name = localeToLanguageName('nl_NL')
    expect(name.toLowerCase()).toContain('dutch')
  })

  it('converts de_DE to a German language name', () => {
    const name = localeToLanguageName('de_DE')
    expect(name.toLowerCase()).toContain('german')
  })

  it('converts fr_FR to a French language name', () => {
    const name = localeToLanguageName('fr_FR')
    expect(name.toLowerCase()).toContain('french')
  })

  it('falls back to the locale string for unknown locales', () => {
    // xx_XX is not a valid BCP-47 tag, Intl should return undefined → fallback
    const name = localeToLanguageName('xx_XX')
    expect(typeof name).toBe('string')
    expect(name.length).toBeGreaterThan(0)
  })
})
