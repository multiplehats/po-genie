import { describe, it, expect } from 'vitest'
import { parseStringifiedArray } from '../src/translate.js'

describe('parseStringifiedArray', () => {
  it('passes real arrays through untouched', () => {
    const value = ['a', 'b']
    expect(parseStringifiedArray(value)).toBe(value)
  })

  it('decodes a valid JSON-encoded string array', () => {
    expect(parseStringifiedArray('["Annuleren","Zeg \\"hoi\\""]')).toEqual(['Annuleren', 'Zeg "hoi"'])
  })

  it('recovers items whose typographic quotes close with an unescaped ASCII quote', () => {
    // Exact shape claude-haiku-4.5 returned for German, Czech, Polish and others.
    const value = '["Fallback auswählen","Titel der Empfehlungen","„Powered by CartPops" anzeigen","Titel des Warenkorb-Drawers"]'

    expect(parseStringifiedArray(value)).toEqual([
      'Fallback auswählen',
      'Titel der Empfehlungen',
      '„Powered by CartPops" anzeigen',
      'Titel des Warenkorb-Drawers',
    ])
  })

  it('keeps JSON escapes while repairing bare quotes', () => {
    expect(parseStringifiedArray('["Regel\\nzwei","„Zitat" mit [VAR_0]"]')).toEqual([
      'Regel\nzwei',
      '„Zitat" mit [VAR_0]',
    ])
  })

  it('tolerates whitespace around delimiters and the whole value', () => {
    expect(parseStringifiedArray(' ["a" , "„b" c"] ')).toEqual(['a', '„b" c'])
  })

  it('leaves values it cannot recover unchanged so validation still fails', () => {
    expect(parseStringifiedArray('not an array')).toBe('not an array')
    expect(parseStringifiedArray('{"a":"b"}')).toBe('{"a":"b"}')
    expect(parseStringifiedArray('["broken \\x escape"]')).toBe('["broken \\x escape"]')
    expect(parseStringifiedArray(42)).toBe(42)
  })
})
