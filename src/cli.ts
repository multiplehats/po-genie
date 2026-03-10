import 'dotenv/config'
import { defineCommand, runMain } from 'citty'
import { translate } from './translate.js'
import type { Progress } from './types.js'

const main = defineCommand({
  meta: {
    name: 'po-genie',
    version: '0.1.0',
    description: 'AI-powered .po file translator',
  },
  args: {
    input: {
      type: 'string',
      description: 'Path to the source .po or .pot file',
      required: true,
      alias: 'i',
    },
    locale: {
      type: 'string',
      description: 'Target locale(s), comma-separated (e.g. nl_NL or nl_NL,de_DE)',
      required: true,
      alias: 'l',
    },
    output: {
      type: 'string',
      description: 'Output path (defaults to input dir with locale suffix)',
      alias: 'o',
    },
    model: {
      type: 'string',
      description: 'OpenRouter model ID (default: anthropic/claude-3.5-haiku)',
      alias: 'm',
    },
    context: {
      type: 'string',
      description: 'Project context to help the AI (e.g. "WordPress loyalty plugin")',
      alias: 'c',
    },
    'batch-size': {
      type: 'string',
      description: 'Strings per AI request (default: 40)',
    },
    'all-strings': {
      type: 'boolean',
      description: 'Re-translate all strings, not just missing ones',
      default: false,
    },
  },
  async run({ args }) {
    const locales = args.locale.split(',').map((l: string) => l.trim())
    const batchSize = args['batch-size'] ? parseInt(args['batch-size'], 10) : undefined

    let lastLocale = ''

    const onProgress = (p: Progress) => {
      if (p.locale !== lastLocale) {
        lastLocale = p.locale
        console.log(`\nTranslating → ${p.locale}`)
      }
      const pct = Math.round((p.translated / p.total) * 100)
      process.stdout.write(
        `\r  Batch ${p.batch}/${p.batches}  [${p.translated}/${p.total}]  ${pct}%`,
      )
    }

    try {
      const results = await translate({
        input: args.input,
        locale: locales.length === 1 ? locales[0] : locales,
        output: args.output,
        model: args.model,
        context: args.context,
        batchSize,
        onlyMissing: !args['all-strings'],
        onProgress,
      })

      console.log('\n')

      let totalPrompt = 0
      let totalCompletion = 0
      let totalCost = 0
      let costKnown = false

      for (const result of results) {
        const { usage } = result
        totalPrompt += usage.promptTokens
        totalCompletion += usage.completionTokens
        if (usage.estimatedCostUsd !== undefined) {
          totalCost += usage.estimatedCostUsd
          costKnown = true
        }

        const costStr = usage.estimatedCostUsd !== undefined
          ? `  ~$${usage.estimatedCostUsd.toFixed(4)}`
          : ''

        console.log(
          `✓ ${result.locale}  →  ${result.output}` +
            `  (${result.translated} translated, ${result.skipped} skipped)${costStr}`,
        )
      }

      if (results.length > 1 || costKnown) {
        const tokensStr = `${(totalPrompt + totalCompletion).toLocaleString()} tokens` +
          ` (${totalPrompt.toLocaleString()} in / ${totalCompletion.toLocaleString()} out)`
        const costStr = costKnown ? `  ~$${totalCost.toFixed(4)} total` : ''
        console.log(`\n  ${tokensStr}${costStr}`)
      }
    } catch (err) {
      console.error('\nError:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  },
})

runMain(main)
