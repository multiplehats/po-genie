import { readFileSync } from 'node:fs'
import { writeFileAtomically } from './atomic-write.js'

export interface ReadmeSegment {
  type: 'passthrough' | 'translatable'
  content: string
  translated?: string
  prefix: string
  suffix: string
  context?: string
}

export interface ReadmeFile {
  segments: ReadmeSegment[]
  save(filePath: string): void
}

/** Metadata keys that appear in the readme header block */
const METADATA_KEYS = new Set([
  'contributors',
  'donate link',
  'tags',
  'requires at least',
  'tested up to',
  'requires php',
  'stable tag',
  'license',
  'license uri',
])

/** Match version-like strings: 1.0, 1.0.0, 1.0.0-beta.1, etc. */
const VERSION_RE = /^\d+\.\d+(\.\d+)?([-.].+)?$/
/** Match bullet list items */
const BULLET_RE = /^(\* )(.+)$/
/** Match numbered list items */
const NUMBERED_RE = /^(\d+\.\s)(.+)$/
/** Match code-indented lines (4+ spaces) */
const CODE_INDENT_RE = /^ {4,}/

function isMetadataLine(line: string): boolean {
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return false
  const key = line.slice(0, colonIndex).trim().toLowerCase()
  return METADATA_KEYS.has(key)
}

function contextForSection(section: string): string {
  const lower = section.toLowerCase()
  if (lower === 'screenshots') return 'screenshot caption'
  if (lower === 'installation') return 'installation step'
  if (lower === 'faq' || lower === 'frequently asked questions') return 'faq answer'
  return 'description'
}

function contextForNumberedItem(section: string): string {
  const lower = section.toLowerCase()
  if (lower === 'screenshots') return 'screenshot caption'
  if (lower === 'installation') return 'installation step'
  return 'list item'
}

function passthrough(content: string): ReadmeSegment {
  return { type: 'passthrough', content, prefix: '', suffix: '' }
}

function translatable(content: string, prefix: string, suffix: string, context: string): ReadmeSegment {
  return { type: 'translatable', content, prefix, suffix, context }
}

export function loadReadme(filePath: string): ReadmeFile {
  return parseReadme(readFileSync(filePath))
}

/** Parse a WordPress readme model from already captured source content. */
export function parseReadme(content: string | Buffer): ReadmeFile {
  const raw = (typeof content === 'string' ? content : content.toString('utf8'))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  const lines = raw.split('\n')
  const segments: ReadmeSegment[] = []

  let phase: 'header' | 'header-blank' | 'short-description' | 'body' = 'header'
  let currentSection = ''
  let inCodeBlock = false
  let paragraphLines: string[] = []
  let paragraphContext = ''

  function flushParagraph() {
    if (paragraphLines.length === 0) return
    segments.push(translatable(
      paragraphLines.join('\n'),
      '',
      '',
      paragraphContext,
    ))
    paragraphLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Phase 1: Header block
    if (phase === 'header') {
      // Line 1: === Plugin Name ===
      if (i === 0 && line.match(/^===\s+.+?\s+===$/)) {
        segments.push(passthrough(line))
        continue
      }

      if (isMetadataLine(line)) {
        segments.push(passthrough(line))
        continue
      }

      if (line.trim() === '') {
        segments.push(passthrough(line))
        phase = 'header-blank'
        continue
      }

      // Unexpected non-metadata line before blank — treat as passthrough
      segments.push(passthrough(line))
      continue
    }

    if (phase === 'header-blank') {
      if (line.trim() === '') {
        segments.push(passthrough(line))
        continue
      }

      // Check if we hit a section header before getting a short description
      if (line.match(/^==\s+.+?\s+==$/)) {
        phase = 'body'
        // Fall through to body processing below
      } else {
        // This is the short description
        segments.push(translatable(line, '', '', 'short description'))
        phase = 'short-description'
        continue
      }
    }

    if (phase === 'short-description') {
      if (line.match(/^==\s+.+?\s+==$/)) {
        phase = 'body'
        // Fall through to body processing below
      } else {
        // Lines between short description and first section header — passthrough
        segments.push(passthrough(line))
        continue
      }
    }

    // Phase 2: Body
    // Handle code blocks (fenced with ```)
    if (inCodeBlock) {
      segments.push(passthrough(line))
      if (line.trim().startsWith('```')) {
        inCodeBlock = false
      }
      continue
    }

    if (line.trim().startsWith('```')) {
      flushParagraph()
      inCodeBlock = true
      segments.push(passthrough(line))
      continue
    }

    // Section headers: == Section ==
    const sectionMatch = line.match(/^==\s+(.+?)\s+==$/)
    if (sectionMatch) {
      flushParagraph()
      currentSection = sectionMatch[1]
      segments.push(passthrough(line))
      continue
    }

    // Subsection headers: = Subsection =
    const subsectionMatch = line.match(/^=\s+(.+?)\s+=\s*$/)
    if (subsectionMatch) {
      flushParagraph()
      const content = subsectionMatch[1]
      if (VERSION_RE.test(content.trim())) {
        segments.push(passthrough(line))
      } else {
        const ctx = currentSection.toLowerCase() === 'faq' || currentSection.toLowerCase() === 'frequently asked questions'
          ? 'faq question'
          : 'subsection heading'
        segments.push(translatable(content, '= ', ' =', ctx))
      }
      continue
    }

    // Blank lines
    if (line.trim() === '') {
      flushParagraph()
      segments.push(passthrough(line))
      continue
    }

    // Code-indented lines (4+ spaces)
    if (CODE_INDENT_RE.test(line)) {
      flushParagraph()
      segments.push(passthrough(line))
      continue
    }

    // Bullet items
    const bulletMatch = line.match(BULLET_RE)
    if (bulletMatch) {
      flushParagraph()
      segments.push(translatable(bulletMatch[2], bulletMatch[1], '', 'list item'))
      continue
    }

    // Numbered items
    const numberedMatch = line.match(NUMBERED_RE)
    if (numberedMatch) {
      flushParagraph()
      segments.push(translatable(
        numberedMatch[2],
        numberedMatch[1],
        '',
        contextForNumberedItem(currentSection),
      ))
      continue
    }

    // Regular text — accumulate into paragraph
    if (paragraphLines.length === 0) {
      paragraphContext = contextForSection(currentSection)
    }
    paragraphLines.push(line)
  }

  // Flush any remaining paragraph
  flushParagraph()

  function serialize(): string {
    return segments.map((s) => {
      const text = s.translated ?? s.content
      return s.prefix + text + s.suffix
    }).join('\n')
  }

  return {
    segments,
    save(filePath: string) {
      writeFileAtomically(filePath, serialize(), 'utf-8')
    },
  }
}
