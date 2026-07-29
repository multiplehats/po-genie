import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import gettextParser from 'gettext-parser'
import { loadPO, localeMetadataFor, localeToLanguageName } from '../src/po.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
  }
})

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

const POT_WITH_EMPTY_LANGUAGE = `
msgid ""
msgstr ""
"Project-Id-Version: po-genie test\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: \\n"

msgid "Save"
msgstr ""
`.trim()

const PO_WITH_STALE_LANGUAGE = `
msgid ""
msgstr ""
"Project-Id-Version: po-genie test\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: en_US\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "File"
msgstr "File"
`.trim()

const PO_WITH_PLURAL_ENTRY = `
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"
"Language: nl_NL\\n"

msgid "File"
msgid_plural "Files"
msgstr[0] "Bestand"
msgstr[1] "Bestanden"
`.trim()

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'po-genie-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function readHeaders(file: string): Record<string, string> {
  return gettextParser.po.parse(readFileSync(file)).headers
}

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

  it('preserves plural source text and every translation form', () => {
    const file = join(tmpDir, 'plural.po')
    const out = join(tmpDir, 'plural-out.po')
    writeFileSync(file, PO_WITH_PLURAL_ENTRY)

    const po = loadPO(file)
    const files = po.entries.find((entry) => entry.msgid === 'File')

    expect(files).toMatchObject({
      msgid: 'File',
      msgid_plural: 'Files',
      msgstr: 'Bestand',
      msgstrs: ['Bestand', 'Bestanden'],
    })

    files!.msgstrs[0] = 'Bestand aangepast'
    files!.msgstrs[1] = 'Bestanden aangepast'
    expect(files!.msgstr).toBe('Bestand aangepast')
    expect(Reflect.set(files!, 'msgstr', 'Bestand via compatibility')).toBe(true)
    expect(files!.msgstrs[0]).toBe('Bestand via compatibility')
    files!.msgstrs = ['Bestand vervangen', 'Bestanden vervangen']
    expect(files!.msgstr).toBe('Bestand vervangen')
    po.save(out)

    const saved = gettextParser.po.parse(readFileSync(out))
    expect(saved.translations['']?.File?.msgstr).toEqual([
      'Bestand vervangen',
      'Bestanden vervangen',
    ])
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

  it('replaces an existing PO destination with compiled bytes', () => {
    const file = join(tmpDir, 'input.po')
    const out = join(tmpDir, 'output.po')
    writeFileSync(file, SIMPLE_PO)
    writeFileSync(out, Buffer.from([0, 1, 2, 3]))

    const po = loadPO(file)
    po.entries.find((entry) => entry.msgid === 'Cancel')!._item.msgstr = ['Annuleren']
    po.save(out)

    expect(readFileSync(out, 'utf-8')).toContain('msgstr "Annuleren"')
  })

  it('keeps the existing PO bytes and removes its sibling temporary file when writing fails', async () => {
    const file = join(tmpDir, 'input.po')
    const out = join(tmpDir, 'output.po')
    const original = Buffer.from([0, 1, 2, 255])
    writeFileSync(file, SIMPLE_PO)
    writeFileSync(out, original)

    const po = loadPO(file)
    po.entries.find((entry) => entry.msgid === 'Cancel')!._item.msgstr = ['Annuleren']

    const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const write = vi.mocked(writeFileSync)
    const previousImplementation = write.getMockImplementation()
    write.mockImplementation((path, data, options) => {
      if (typeof path === 'string' && dirname(path) === tmpDir && path !== out) {
        actualFs.writeFileSync(path, Buffer.from('partial'))
        throw new Error('injected write failure')
      }
      return actualFs.writeFileSync(path, data, options)
    })

    try {
      expect(() => po.save(out)).toThrow('injected write failure')
    } finally {
      write.mockImplementation(previousImplementation!)
    }

    expect(readFileSync(out)).toEqual(original)
    expect(readdirSync(tmpDir).sort()).toEqual(['input.po', 'output.po'])
  })

  it('throws for a non-existent file', () => {
    expect(() => loadPO(join(tmpDir, 'missing.po'))).toThrow()
  })

  it('sets normalized Dutch metadata on a POT while preserving unrelated headers', () => {
    const file = join(tmpDir, 'messages.pot')
    const out = join(tmpDir, 'messages-nl_NL.po')
    writeFileSync(file, POT_WITH_EMPTY_LANGUAGE)

    const po = loadPO(file)
    const metadata = localeMetadataFor('nl-NL')
    po.setLocale('nl-NL')
    po.save(out)

    expect(metadata).toMatchObject({
      locale: 'nl_NL',
      pluralForms: 'nplurals=2; plural=(n != 1);',
      pluralFormCount: 2,
    })
    const headers = readHeaders(out)
    expect(headers.Language).toBe('nl_NL')
    expect(headers['Plural-Forms']).toBe('nplurals=2; plural=(n != 1);')
    expect(headers['Project-Id-Version']).toBe('po-genie test')
    expect(headers['Content-Type']).toBe('text/plain; charset=utf-8')
  })

  it('replaces stale source metadata with the authoritative Polish three-form rule', () => {
    const file = join(tmpDir, 'messages.po')
    const out = join(tmpDir, 'messages-pl_PL.po')
    writeFileSync(file, PO_WITH_STALE_LANGUAGE)

    const po = loadPO(file)
    const metadata = localeMetadataFor('pl_PL')
    po.setLocale('pl_PL')
    po.save(out)

    expect(metadata).toMatchObject({
      locale: 'pl_PL',
      pluralFormCount: 3,
    })
    const headers = readHeaders(out)
    expect(headers.Language).toBe('pl_PL')
    expect(headers['Plural-Forms']).toBe(
      'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    )
    expect(headers['Project-Id-Version']).toBe('po-genie test')
  })

  it('sets French metadata with the source catalog unary-minus rule', () => {
    const file = join(tmpDir, 'messages.pot')
    const out = join(tmpDir, 'messages-fr_FR.po')
    writeFileSync(file, POT_WITH_EMPTY_LANGUAGE)

    const po = loadPO(file)
    po.setLocale('fr_FR')
    po.save(out)

    const headers = readHeaders(out)
    expect(headers.Language).toBe('fr_FR')
    expect(headers['Plural-Forms']).toBe(
      'nplurals=2; plural=(n > 1);',
    )
    expect(headers['Project-Id-Version']).toBe('po-genie test')
  })

  it('preserves the distinct GNU gettext rules for Brazilian and European Portuguese', () => {
    const cases = [
      ['pt_BR', 'nplurals=2; plural=(n > 1);'],
      ['pt_PT', 'nplurals=2; plural=(n != 1);'],
    ] as const

    for (const [locale, pluralForms] of cases) {
      const file = join(tmpDir, `messages-${locale}.pot`)
      const out = join(tmpDir, `messages-${locale}.po`)
      writeFileSync(file, POT_WITH_EMPTY_LANGUAGE)

      const po = loadPO(file)
      po.setLocale(locale)
      po.save(out)

      const headers = readHeaders(out)
      expect(headers.Language).toBe(locale)
      expect(headers['Plural-Forms']).toBe(pluralForms)
      expect(headers['Project-Id-Version']).toBe('po-genie test')
    }
  })

  it.each([
    ['el_POLYTON', 'el_polyton', 'nplurals=2; plural=(n != 1);'],
    ['ca_ES_VALENCIA', 'ca_ES_valencia', 'nplurals=2; plural=(n != 1);'],
    [
      'be_TARASK',
      'be_tarask',
      'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    ],
    ['en_US_POSIX', 'en_US_u_va_posix', 'nplurals=2; plural=(n != 1);'],
  ])(
    'resolves the canonical gettext variant %s',
    (locale, normalizedLocale, pluralForms) => {
      const file = join(tmpDir, `messages-${locale}.pot`)
      const out = join(tmpDir, `messages-${locale}.po`)
      writeFileSync(file, POT_WITH_EMPTY_LANGUAGE)

      const po = loadPO(file)
      po.setLocale(locale)
      po.save(out)

      const headers = readHeaders(out)
      expect(headers.Language).toBe(normalizedLocale)
      expect(headers['Plural-Forms']).toBe(pluralForms)
    },
  )

  it('rejects unsupported locales before an output file can be replaced', () => {
    const file = join(tmpDir, 'messages.pot')
    const out = join(tmpDir, 'messages-xx_XX.po')
    writeFileSync(file, POT_WITH_EMPTY_LANGUAGE)
    writeFileSync(out, 'existing output')

    const po = loadPO(file)
    expect(() => po.setLocale('xx_XX')).toThrow(
      'Unsupported gettext plural rules for locale "xx_XX"',
    )
    expect(readFileSync(out, 'utf-8')).toBe('existing output')
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
