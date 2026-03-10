import gettextParser from 'gettext-parser'
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
  /** Serialise back to .po format */
  save(outputPath: string): void
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
    save(outputPath) {
      const output = gettextParser.po.compile(parsed)
      writeFileSync(outputPath, output)
    },
  }
}

/** Resolve a language name from a locale code using the native Intl API */
export function localeToLanguageName(locale: string): string {
  try {
    const bcp47 = locale.replace('_', '-')
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(bcp47) ?? locale
  } catch {
    return locale
  }
}
