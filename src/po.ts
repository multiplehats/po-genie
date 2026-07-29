import gettextParser from 'gettext-parser'
import { readFileSync } from 'node:fs'
import { writeFileAtomically } from './atomic-write.js'

export interface POEntry {
  msgid: string
  msgid_plural?: string
  msgctxt?: string
  /** Compatibility view of msgstrs[0]. */
  msgstr: string
  /** Authoritative gettext translation forms, indexed by plural slot. */
  msgstrs: string[]
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
    const parts = locale.replaceAll('-', '_').split('_')
    if (
      !/^[A-Za-z]{2,3}$/.test(parts[0] ?? '') ||
      parts.slice(1).some((part) => !/^[A-Za-z0-9]{2,8}$/.test(part))
    ) {
      throw new Error(`Invalid locale "${locale}"`)
    }

    return parts.map((part, index) => {
      if (index === 0) return part.toLowerCase()
      if (index === 1 && /^[A-Za-z]{4}$/.test(part)) {
        return part[0].toUpperCase() + part.slice(1).toLowerCase()
      }
      if (
        (index === 1 || (index === 2 && /^[A-Za-z]{4}$/.test(parts[1])))
        && /^(?:[A-Za-z]{2}|\d{3})$/.test(part)
      ) {
        return part.toUpperCase()
      }
      return part.toLowerCase()
    }).join('_')
  }
}

/**
 * Complete generated registry for locales shared by Babel 2.17.0 and GNU
 * gettext 1.0 msginit. Babel's maintained, BSD-3-Clause/Unicode-licensed
 * locale registry supplied the identifiers; msginit supplied the GNU header
 * values. No GNU source code or runtime binary is included.
 *
 * Generator inputs:
 * - Babel 2.17.0 (`babel.localedata.locale_identifiers()`)
 * - https://ftp.gnu.org/gnu/gettext/gettext-1.0.tar.gz
 * - gettext tar SHA-256:
 *   85d99b79c981a404874c02e0342176cf75c7698e2b51fe41031cf6526d974f1a
 */
const GNU_GETTEXT_PLURAL_GROUPS = [
  [
    'nplurals=1; plural=0;',
    `vi ja ko ko_CN vi_VN ja_JP ko_KR ko_KP`,
  ],
  [
    'nplurals=2; plural=(n != 1);',
    `tr_CY en_DG nl_CW nn es_GQ no nl_BE es_PY en_JM en_KI en_SX en_SZ en_GH
    ca_IT en_Dsrt_US et_EE nl es_SV nl_BQ en_DE en_GI en_FM tr_TR en_PW en_SL
    en_SH en_KY en_KN en_ER en_FI en_GM en_150 ca_ES es_HN es_PH en_Dsrt en_PR
    en_SI en_PG pt_PT en_IE en_GY en_FJ sv_AX es_419 tr es_DO es_GT en_Shaw_GB
    en_FK en_ID fo_DK bg_BG en_UM en_NG en_BS pt_MO es_AR nb_SJ es_CL nl_SX
    de_LU en_CA en_BE en_AI en_NF pt_TL en_WS en_VU el_POLYTON en_ZA en_MH
    pt_AO en_CC es_NI es_CO it_CH pt_MZ hu_HU en_NR en_ZW en_VC en_TK en_VG
    en_TO en_NA en_BB sv el es_BO de_AT da_DK en_MY pt_CV en_NU eo es_BZ de_CH
    en es_US en_BW sv_FI en_MO en_TZ sv_SE en_US en_MU en_BM pt_LU en_BZ
    es_VE es_MX et fo es_CR he pt en_CH en_MT en_VI en_TV en_TT en_UG en_TC
    en_MV en_LR en_NZ en_AU de_LI it_VA it nl_SR de el_CY en_CK en_AT en_LS
    en_MW en_NL en_ZM ca_ES_VALENCIA en_MS en_AG en_CX da fi es_CU hu es es_UY
    en_CY en_US_POSIX en_LC pt_CH en_MG en_MP en_AS fi_FI da_GL ca_AD es_BR
    de_BE en_BI en_CM en_AE en_PK en_SG pt_ST en_JE pt_GQ en_GU en_GB it_IT
    it_SM en_Shaw ca nl_AW fo_FO en_PH en_SS en_RW en_SD en_DM es_PE es_PR
    ca_FR bg es_ES el_GR nl_NL en_001 en_SE pt_GW en_HK en_IO en_GD de_IT
    es_EA de_DE es_IC es_PA he_IL en_IN eo_001 en_SB en_PN en_IL en_GG en_DK
    nb es_EC nb_NO nn_NO en_IM en_KE en_SC`,
  ],
  [
    'nplurals=2; plural=(n > 1);',
    `fr_GN fr_KM fr_PF fr_HT fr_SY fr_SN fr_NC fr_CD fr_CF fr fr_TN fr_ML
    fr_CG fr_WF fr_VU fr_NE fr_BF pt_BR fr_CA fr_BE fr_MG fr_TD fr_YT fr_MF
    fr_MQ fr_LU fr_BI fr_CM fr_TG fr_MR fr_BJ fr_MA fr_CI fr_MU fr_MC fr_BL
    fr_CH fr_GP fr_SC fr_GF fr_DJ fr_GQ fr_PM fr_RE fr_DZ fr_GA fr_FR fr_RW`,
  ],
  [
    'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2);',
    `lv lv_LV`,
  ],
  [
    'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && (n%100<10 || n%100>=20) ? 1 : 2);',
    `lt lt_LT`,
  ],
  [
    'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    `ru_RU sr_Latn_BA ru_KG sr_Latn_XK sr_Latn sr_Cyrl_BA ru ru_BY sr ru_MD
    ru_UA sr_Cyrl_XK sr_Latn_RS hr sr_Cyrl_ME sr_Cyrl be_TARASK hr_HR uk_UA
    sr_Latn_ME be_BY be hr_BA sr_Cyrl_RS uk ru_KZ`,
  ],
  [
    'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);',
    `pl pl_PL`,
  ],
  [
    'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
    `sk_SK sk cs_CZ cs`,
  ],
  [
    'nplurals=3; plural=n==1 ? 0 : (n==0 || (n%100 > 0 && n%100 < 20)) ? 1 : 2;',
    `ro_MD ro ro_RO`,
  ],
  [
    'nplurals=3; plural=n==1 ? 0 : n==2 ? 1 : 2;',
    `ga_GB ga ga_IE`,
  ],
  [
    'nplurals=4; plural=(n%100==1 ? 0 : n%100==2 ? 1 : n%100==3 || n%100==4 ? 2 : 3);',
    `sl_SI sl`,
  ],
] as const

const GNU_GETTEXT_PLURAL_FORMS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    GNU_GETTEXT_PLURAL_GROUPS.flatMap(([formula, locales]) =>
      locales.trim().split(/\s+/).map((locale) => [normalizeLocale(locale), formula]),
    ),
  ),
)

function pluralFormsForLocale(locale: string): string {
  let ruleLocale = locale
  let sourceHeader = GNU_GETTEXT_PLURAL_FORMS[ruleLocale]
  while (!sourceHeader && ruleLocale.includes('_')) {
    ruleLocale = ruleLocale.slice(0, ruleLocale.lastIndexOf('_'))
    sourceHeader = GNU_GETTEXT_PLURAL_FORMS[ruleLocale]
  }
  if (!sourceHeader) {
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
    /===|!==/.test(expression) ||
    /[^n0-9\s%<>=!&|?:()+*/-]/.test(expression)
  ) {
    throw new Error(`Unsupported gettext plural rules for locale "${locale}"`)
  }

  return header
}

export interface LocaleMetadata {
  locale: string
  pluralForms: string
  pluralFormCount: number
}

/** Resolve validated GNU gettext metadata for a target locale. */
export function localeMetadataFor(locale: string): LocaleMetadata {
  const normalizedLocale = normalizeLocale(locale)
  const pluralForms = pluralFormsForLocale(normalizedLocale)
  // pluralFormsForLocale has already validated this GNU nplurals header.
  const formCount = pluralForms.match(/^nplurals\s*=\s*([1-9]\d*)\s*;/)?.[1]

  if (!formCount) {
    throw new Error(`Unsupported gettext plural rules for locale "${normalizedLocale}"`)
  }

  return {
    locale: normalizedLocale,
    pluralForms,
    pluralFormCount: Number(formCount),
  }
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
        msgid_plural: item.msgid_plural,
        msgctxt: item.msgctxt,
        get msgstr() {
          return item.msgstr[0] ?? ''
        },
        set msgstr(value) {
          item.msgstr[0] = value
        },
        get msgstrs() {
          return item.msgstr
        },
        set msgstrs(value) {
          item.msgstr = value
        },
        _item: item,
      })
    }
  }

  return {
    entries,
    setLocale(locale) {
      const metadata = localeMetadataFor(locale)
      parsed.headers.Language = metadata.locale
      parsed.headers['Plural-Forms'] = metadata.pluralForms
    },
    save(outputPath) {
      const output = gettextParser.po.compile(parsed)
      writeFileAtomically(outputPath, output)
    },
  }
}

/** Resolve a language name from a locale code using the native Intl API */
export function localeToLanguageName(locale: string): string {
  try {
    const normalizedLocale = normalizeLocale(locale)
    const bcp47 = normalizedLocale.replaceAll('_', '-')
    const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(bcp47)
    if (!languageName) return locale
    return normalizedLocale.split('_').length > 2
      ? `${languageName} (${locale})`
      : languageName
  } catch {
    return locale
  }
}
