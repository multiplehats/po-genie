import { describe, it, expect } from 'vitest'
import {
  extractVariables,
  restoreVariables,
  hasVariables,
  validateProtectedTokens,
  extractProtectedFragments,
  restoreProtectedFragments,
} from '../src/variables.js'

describe('extractVariables', () => {
  it('extracts handlebars-style variables {{var}}', () => {
    const { template, vars } = extractVariables('You have {{credits}} {{credits_currency}}')
    expect(template).toBe('You have [VAR_0] [VAR_1]')
    expect(vars).toEqual(['{{credits}}', '{{credits_currency}}'])
  })

  it('extracts printf %s variables', () => {
    const { template, vars } = extractVariables('Earn %s points with %d purchases')
    expect(template).toBe('Earn [VAR_0] points with [VAR_1] purchases')
    expect(vars).toEqual(['%s', '%d'])
  })

  it('extracts positional printf %1$s variables', () => {
    const { template, vars } = extractVariables('Order %1$s of %2$s items')
    expect(template).toBe('Order [VAR_0] of [VAR_1] items')
    expect(vars).toEqual(['%1$s', '%2$s'])
  })

  it('extracts single-brace {variable} variables', () => {
    const { template, vars } = extractVariables('Welcome, {name}!')
    expect(template).toBe('Welcome, [VAR_0]!')
    expect(vars).toEqual(['{name}'])
  })

  it('extracts Python-style %(name)s variables', () => {
    const { template, vars } = extractVariables('%(count)s results found')
    expect(template).toBe('[VAR_0] results found')
    expect(vars).toEqual(['%(count)s'])
  })

  it('deduplicates repeated variables with the same token', () => {
    const { template, vars } = extractVariables('{{credits}} of {{max}} ({{credits}} used)')
    expect(template).toBe('[VAR_0] of [VAR_1] ([VAR_0] used)')
    expect(vars).toEqual(['{{credits}}', '{{max}}'])
  })

  it('returns unchanged string when no variables present', () => {
    const { template, vars } = extractVariables('No variables here')
    expect(template).toBe('No variables here')
    expect(vars).toEqual([])
  })

  it('handles empty string', () => {
    const { template, vars } = extractVariables('')
    expect(template).toBe('')
    expect(vars).toEqual([])
  })
})

describe('restoreVariables', () => {
  it('restores extracted variables back into translated string', () => {
    const vars = ['{{credits}}', '{{credits_currency}}']
    const result = restoreVariables('Je hebt [VAR_0] [VAR_1]', vars)
    expect(result).toBe('Je hebt {{credits}} {{credits_currency}}')
  })

  it('restores deduplicated variable correctly', () => {
    const vars = ['{{credits}}', '{{max}}']
    const result = restoreVariables('[VAR_0] van [VAR_1] ([VAR_0] gebruikt)', vars)
    expect(result).toBe('{{credits}} van {{max}} ({{credits}} gebruikt)')
  })

  it('leaves unknown tokens in place rather than dropping them', () => {
    const result = restoreVariables('Hello [VAR_99] world', [])
    expect(result).toBe('Hello [VAR_99] world')
  })

  it('handles string with no tokens', () => {
    const result = restoreVariables('Geen variabelen', [])
    expect(result).toBe('Geen variabelen')
  })
})

describe('validateProtectedTokens', () => {
  it.each([
    ['omitted', 'Vertaal [VAR_0]', 'Vertaling'],
    ['duplicated', 'Vertaal [VAR_0]', 'Vertaling [VAR_0] [VAR_0]'],
    ['renamed', 'Vertaal [VAR_0]', 'Vertaling [VAR_1]'],
    ['invented', 'Vertaal zonder tokens', 'Vertaling [VAR_99]'],
  ])('rejects %s protected tokens', (_case, source, translated) => {
    expect(() => validateProtectedTokens(source, translated, {
      locale: 'nl_NL',
      batch: 2,
      item: 3,
    })).toThrow(/nl_NL.*batch 2.*item 3.*VAR_/)
  })

  it('allows protected tokens to be reordered', () => {
    expect(() => validateProtectedTokens(
      '[VAR_0] before [VAR_1]',
      '[VAR_1] na [VAR_0]',
      { locale: 'nl_NL', batch: 1, item: 1 },
    )).not.toThrow()
  })

  it('requires repeated source tokens to retain their exact multiplicity', () => {
    expect(() => validateProtectedTokens(
      '[VAR_0] of [VAR_1] ([VAR_0] used)',
      '[VAR_0] van [VAR_1] ([VAR_0] gebruikt)',
      { locale: 'nl_NL', batch: 1, item: 1 },
    )).not.toThrow()

    expect(() => validateProtectedTokens(
      '[VAR_0] of [VAR_1] ([VAR_0] used)',
      '[VAR_0] van [VAR_1] gebruikt',
      { locale: 'nl_NL', batch: 1, item: 1 },
    )).toThrow(/VAR_0/)
  })
})

describe('protected immutable fragments', () => {
  it('extracts URLs, Markdown destinations, inline code, and HTML tags without protecting labels', () => {
    const extracted = extractProtectedFragments(
      'Read [the docs](https://example.com/docs) or `run --help` in <strong>your browser</strong> at https://example.org/path.',
    )

    expect(extracted.template).toBe(
      'Read [the docs]([IMM_0]) or [IMM_1] in [IMM_2]your browser[IMM_3] at [IMM_4].',
    )
    expect(extracted.fragments).toEqual([
      'https://example.com/docs',
      '`run --help`',
      '<strong>',
      '</strong>',
      'https://example.org/path',
    ])
  })

  it('restores immutable fragments after translating a Markdown label', () => {
    const extracted = extractProtectedFragments('Read [the docs](https://example.com/docs).')

    expect(restoreProtectedFragments(
      'Lees [de documentatie]([IMM_0]).',
      extracted,
    )).toBe('Lees [de documentatie](https://example.com/docs).')
  })

  it('uses collision-safe token IDs when source text contains an immutable token', () => {
    const extracted = extractProtectedFragments(
      'Keep [IMM_0] visible and visit https://example.com.',
    )

    expect(extracted.template).toBe('Keep [IMM_0] visible and visit [IMM1_0].')
    expect(restoreProtectedFragments(extracted.template, extracted)).toBe(
      'Keep [IMM_0] visible and visit https://example.com.',
    )
  })
})

describe('hasVariables', () => {
  it('returns true for strings with {{}} variables', () => {
    expect(hasVariables('You have {{credits}}')).toBe(true)
  })

  it('returns true for strings with printf variables', () => {
    expect(hasVariables('Earn %s points')).toBe(true)
  })

  it('returns true for positional printf', () => {
    expect(hasVariables('Order %1$s of %2$s')).toBe(true)
  })

  it('returns false for plain strings', () => {
    expect(hasVariables('No variables here')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasVariables('')).toBe(false)
  })
})

describe('round-trip', () => {
  const cases = [
    'You have {{credits}} {{credits_currency}}',
    'Earn %s points with %d purchases',
    'Order %1$s of %2$s items',
    'Welcome, {name}! You have %(count)s messages',
    '{{credits}} of {{max}} ({{credits}} used)',
  ]

  for (const original of cases) {
    it(`preserves "${original}" through extract → translate → restore`, () => {
      const { template, vars } = extractVariables(original)
      // Simulate AI translating only the non-variable text (tokens stay identical)
      const simulatedTranslation = template.replace('You have', 'Je hebt')
        .replace('Earn', 'Verdien')
        .replace('points with', 'punten met')
        .replace('purchases', 'aankopen')
        .replace('Order', 'Bestelling')
        .replace('of', 'van')
        .replace('items', 'artikelen')
        .replace('Welcome,', 'Welkom,')
        .replace('You have', 'Je hebt')
        .replace('messages', 'berichten')
        .replace('of', 'van')
      const restored = restoreVariables(simulatedTranslation, vars)
      // All original variable values must appear in the final string
      for (const v of vars) {
        expect(restored).toContain(v)
      }
    })
  }
})
