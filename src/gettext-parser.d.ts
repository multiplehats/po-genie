declare module 'gettext-parser' {
  export interface GetTextTranslation {
    msgid: string
    msgctxt?: string
    msgstr: string[]
    comments?: {
      translator?: string
      reference?: string
      extracted?: string
      flag?: string
      previous?: string
    }
  }

  export interface GetTextTranslations {
    charset: string
    headers: Record<string, string>
    translations: Record<string, Record<string, GetTextTranslation>>
  }

  export const po: {
    parse(input: Buffer | string): GetTextTranslations
    compile(table: GetTextTranslations, options?: { foldLength?: number }): Buffer
  }

  export const mo: {
    parse(input: Buffer): GetTextTranslations
    compile(table: GetTextTranslations): Buffer
  }
}
