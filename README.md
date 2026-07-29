<p align="center">
  <img src="assets/logo.png" alt="PO Genie" width="720">
</p>

# po-genie

AI-powered translator for gettext `.po` / `.pot` catalogs and WordPress
`readme.txt` files. It uses any model available on
[OpenRouter](https://openrouter.ai), preserves structural fragments, and
validates every translated batch before accepting it.

## Features

- Translates missing gettext entries or the translatable parts of a WordPress readme
- Generates every gettext plural form and sets the target `Language` and `Plural-Forms` headers
- Protects variables, HTML, URLs, Markdown destinations, and inline code from structural changes
- Validates response counts and protected fragments before applying a batch
- Resumes interrupted work from safe, identity-checked checkpoints
- Writes final outputs and checkpoints atomically
- Runs multiple target locales with configurable bounded concurrency
- Provides token usage and optional cost estimates through the API and CLI

## Quick start

**1. Get an API key** from [openrouter.ai/keys](https://openrouter.ai/keys) — free to sign up.

**2. Run without installing:**

```bash
# Using npx
OPENROUTER_API_KEY=sk-or-... npx po-genie -i languages/messages.pot -l nl_NL

# Using pnpm
OPENROUTER_API_KEY=sk-or-... pnpm dlx po-genie -i languages/messages.pot -l nl_NL
```

Or put your key in a `.env` file in your project root and it will be picked up automatically:

```bash
# .env
OPENROUTER_API_KEY=sk-or-...
```

```bash
npx po-genie -i languages/messages.pot -l nl_NL
```

**3. Or install globally:**

```bash
npm install -g po-genie
# then
po-genie -i languages/messages.pot -l nl_NL
```

## Examples

```bash
# Translate a .pot file to Dutch
npx po-genie -i languages/messages.pot -l nl_NL

# Translate an existing .po file in-place (only fills missing strings)
npx po-genie -i languages/messages-nl_NL.po -l nl_NL

# Multiple locales at once
npx po-genie -i languages/messages.pot -l nl_NL,de_DE,fr_FR

# Translate a WordPress plugin readme
npx po-genie -i readme.txt -l nl_NL

# Specify model and add project context for better quality
npx po-genie -i languages/messages.pot -l nl_NL \
  -m google/gemini-2.0-flash-001 \
  -c "WordPress WooCommerce loyalty plugin"
```

## CLI reference

```
po-genie [OPTIONS]

  -i, --input       (required) Path to source .po, .pot, or readme .txt file
  -l, --locale      (required) Target locale(s), comma-separated (e.g. nl_NL or nl_NL,de_DE)
  -o, --output      Output path (default: input dir with locale suffix)
  -m, --model       OpenRouter model ID (default: anthropic/claude-3.5-haiku)
  -c, --context     Project context sent to the AI for better quality
  --batch-size      Strings per AI request (default: 40)
  --concurrency     Maximum locale translations run at once (default: 2)
  --all-strings     Re-translate all gettext strings, not just missing ones
```

Batch size and concurrency values must be positive integers.

### Input and output behaviour

| Input | Locale | Output |
|---|---|---|
| `messages.pot` | `nl_NL` | `messages-nl_NL.po` (same dir) |
| `messages-nl_NL.po` | `nl_NL` | `messages-nl_NL.po` (in-place) |
| `readme.txt` | `nl_NL` | `readme-nl_NL.txt` (same dir) |
| any supported file | one locale | exact file from `--output` |
| any supported file | multiple locales | one locale-suffixed file in the existing `--output` directory |

Without `--output`, multi-locale files are written beside the input. Results
keep the requested locale order even when locale jobs finish out of order.
If one locale fails, already-started jobs are allowed to settle, no new jobs
are started, successful outputs are reported, and the CLI exits unsuccessfully.

## WordPress plugin & theme workflow

If you use WP-CLI's `wp i18n` commands, po-genie fits naturally into your existing i18n workflow.

**1. Generate your `.pot` file** (if you don't already have one):

```bash
wp i18n make-pot . languages/my-plugin.pot --slug=my-plugin --domain=my-plugin
```

**2. Add your API key** — create a `.env` file in your plugin/theme root:

```bash
# .env  (add this to .gitignore!)
OPENROUTER_API_KEY=sk-or-...
```

**3. Translate:**

```bash
npx po-genie -i languages/my-plugin.pot -l nl_NL,de_DE,fr_FR \
  -c "WordPress plugin for [what your plugin does]"
```

This generates `languages/my-plugin-nl_NL.po`, `my-plugin-de_DE.po`, etc.

**4. Translate the plugin readme, if present:**

```bash
npx po-genie -i readme.txt -l nl_NL,de_DE
```

This generates `readme-nl_NL.txt`, `readme-de_DE.txt`, etc. Plugin metadata,
version headings, and code blocks remain unchanged.

**5. Compile catalogs to `.mo`:**

```bash
wp i18n make-mo languages/
```

**Tip — add it to your `package.json` scripts** so the whole flow is one command:

```json
{
  "scripts": {
    "i18n": "wp i18n make-pot . languages/my-plugin.pot --slug=my-plugin --domain=my-plugin",
    "i18n:translate": "po-genie -i languages/my-plugin.pot -l nl_NL,de_DE -c \"My plugin description\"",
    "i18n:compile": "wp i18n make-mo languages/"
  }
}
```

```bash
pnpm i18n && pnpm i18n:translate && pnpm i18n:compile
```

> **Re-running is safe.** po-genie only fills in `msgstr ""` entries. Already-translated strings are never touched. Run it again whenever you add new strings.

## Programmatic API

```ts
import { translate } from 'po-genie'

const results = await translate({
  input: './languages/messages.pot',
  locale: ['nl_NL', 'de_DE'],
  model: 'google/gemini-2.0-flash-001',
  context: 'WordPress e-commerce plugin',
  batchSize: 40,
  concurrency: 2,
  onProgress: ({ locale, translated, total, batch, batches }) => {
    console.log(`${locale}: ${translated}/${total} (${batch}/${batches})`)
  },
})

for (const result of results) {
  console.log(result.locale, result.output, result.usage.totalTokens)
}
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `input` | `string` | — | Path to source `.po`, `.pot`, or WordPress readme `.txt` file |
| `locale` | `string \| string[]` | — | Target locale(s) |
| `output` | `string` | auto | Exact output file for one locale; existing output directory for multiple locales |
| `model` | `string` | `anthropic/claude-3.5-haiku` | OpenRouter model ID |
| `apiKey` | `string` | `OPENROUTER_API_KEY` env | OpenRouter API key |
| `context` | `string` | — | Project description for the AI |
| `batchSize` | positive integer | `40` | Translation jobs per provider request |
| `concurrency` | positive integer | `2` | Maximum locale translations running at once |
| `onlyMissing` | `boolean` | `true` | For gettext, preserve completed plural slots and translate only required empty slots |
| `onProgress` | `(progress: Progress) => void` | — | Called after each validated, checkpointed batch |

### Results, progress, and failures

```ts
interface Progress {
  locale: string
  translated: number
  total: number
  batch: number
  batches: number
}

interface TranslateResult {
  locale: string
  output: string
  translated: number
  skipped: number
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    estimatedCostUsd?: number
  }
}
```

For gettext, `translated` and `total` count catalog entries, including an
entry only after all of its required plural forms are complete. `skipped`
counts catalog entries not selected. For a readme, the counts refer to
translatable segments and `skipped` is always zero. Resumed work is included
in `translated` and `usage`; unavailable usage from failed provider attempts
cannot be included.

With multiple locales, `translate()` either returns all results in requested
order or throws `LocaleTranslationError` after every started job settles:

```ts
import { LocaleTranslationError, translate } from 'po-genie'

try {
  await translate({
    input: './languages/messages.pot',
    locale: ['nl_NL', 'de_DE', 'fr_FR'],
  })
} catch (error) {
  if (error instanceof LocaleTranslationError) {
    console.log(error.successes)        // complete TranslateResult objects
    console.log(error.failures)         // Array<{ locale: string }>
    console.log(error.unstartedLocales) // locale strings
  }
}
```

Failure details expose locale names rather than provider request or response
content. Completed locale outputs remain usable.

### Checkpoints and output safety

After each validated batch, po-genie atomically writes a checkpoint beside the
planned output:

```text
<output>.po-genie-checkpoint.json
```

Re-running the same translation resumes completed work and accumulated known
usage automatically. The source contents, locale, pipeline, model, batch size,
`onlyMissing`, and project context must still match. A corrupt or mismatched
checkpoint is left untouched and produces an error explaining that it must be
removed to restart.

On success, the final PO or readme is replaced atomically and its checkpoint is
removed. If the final write fails, an existing output is preserved.

## Variable detection

The following patterns are detected, tokenised before translation, and restored after:

| Pattern | Example |
|---|---|
| Handlebars / custom | `{{credits}}`, `{{credits_currency}}` |
| Printf | `%s`, `%d`, `%f` |
| Positional printf | `%1$s`, `%2$d` |
| Python-style | `%(name)s` |
| Single-brace | `{variable}` |

## Models and cost estimates

Pass any model ID supported by your OpenRouter account. Token counts are
reported for successful provider responses. `estimatedCostUsd` is included
only for model IDs in po-genie's built-in price table; it is an estimate, not
a billing guarantee. Model availability and pricing change, so use
OpenRouter's current model page and your provider bill as the authority.

## License

MIT
