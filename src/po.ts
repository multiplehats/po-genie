import gettextParser from 'gettext-parser'
import { getPluralFormsHeader } from 'plural-forms'
import { readFileSync, writeFileSync } from 'node:fs'

export interface POEntry {
  msgid: string
  msgctxt?: string
  msgstr: string
  /** Reference back to the parsed item for mutation */
  _item: gettextParser.GetTextTranslation
}

export interface POFile {
  entries: POEntry[]
  /** Set normalized target-language metadata before serializing */
  setLocale(locale: string): void
  /** Serialise back to .po format */
  save(outputPath: string): void
}

function normalizeLocale(locale: string): string {
  try {
    return new Intl.Locale(locale.replaceAll('_', '-')).baseName.replaceAll('-', '_')
  } catch {
    throw new Error(`Invalid locale "${locale}"`)
  }
}

function pluralFormsForLocale(locale: string): string {
  let sourceHeader: string
  try {
    sourceHeader = getPluralFormsHeader(locale)
  } catch {
    throw new Error(`Unsupported gettext plural rules for locale "${locale}"`)
  }

  // GNU gettext rules are sourced from the maintained `plural-forms` catalog:
  // https://github.com/c-3po-org/plural-forms
  if (typeof sourceHeader !== 'string') {
    throw new Error(`Unsupported gettext plural rules for locale "${locale}"`)
  }

  const trimmedHeader = sourceHeader.trim()
  const header = trimmedHeader.endsWith(';') ? trimmedHeader : `${trimmedHeader};`
  const match = header.match(
    /^nplurals\s*=\s*([1-9]\d*)\s*;\s*plural\s*=\s*(.+)\s*;$/,
  )
  const expression = match?.[2]

  // Reject source entries that are not valid GNU gettext C-style expressions.
  if (
    !expression ||
    /===|!==|-\s*\d/.test(expression) ||
    /[^n0-9\s%<>=!&|?:()+*/-]/.test(expression)
  ) {
    throw new Error(`Unsupported gettext plural rules for locale "${locale}"`)
  }

  return header
}

export function loadPO(filePath: string): POFile {
  const content = readFileSync(filePath)
  const parsed = gettextParser.po.parse(content)

  const entries: POEntry[] = []

  for (const context of Object.values(parsed.translations)) {
    for (const item of Object.values(context)) {
      // Skip the file header entry (empty msgid)
      if (!item.msgid) continue

      entries.push({
        msgid: item.msgid,
        msgctxt: item.msgctxt,
        msgstr: item.msgstr[0] ?? '',
        _item: item,
      })
    }
  }

  return {
    entries,
    setLocale(locale) {
      const normalizedLocale = normalizeLocale(locale)
      const pluralForms = pluralFormsForLocale(normalizedLocale)
      parsed.headers.Language = normalizedLocale
      parsed.headers['Plural-Forms'] = pluralForms
    },
    save(outputPath) {
      const output = gettextParser.po.compile(parsed)
      writeFileSync(outputPath, output)
    },
  }
}

/** Resolve a language name from a locale code using the native Intl API */
export function localeToLanguageName(locale: string): string {
  try {
    const bcp47 = normalizeLocale(locale).replaceAll('_', '-')
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(bcp47) ?? locale
  } catch {
    return locale
  }
}
