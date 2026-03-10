import { describe, it, expect } from 'vitest'
import { extractVariables, restoreVariables, hasVariables } from '../src/variables.js'

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
