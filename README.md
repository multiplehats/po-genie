<p align="center">
  <img src="assets/logo.png" alt="PO Genie" width="720">
</p>

# po-genie

AI-powered `.po` / `.pot` file translator. Fills in missing translations using any model available on [OpenRouter](https://openrouter.ai), with reliable variable detection so `{{credits}}`, `%s`, `%1$s` and friends always survive the round-trip.

## Features

- Translates untranslated `msgstr ""` entries, leaves existing translations alone
- Detects and tokenises variables before sending to the AI — they cannot be mangled
- Batches strings for efficiency (configurable batch size)
- Works with any OpenRouter model — pick the right cost/quality trade-off
- Multiple target locales in one command
- Programmatic API + CLI

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

# Specify model and add project context for better quality
npx po-genie -i languages/messages.pot -l nl_NL \
  -m google/gemini-2.0-flash-001 \
  -c "WordPress WooCommerce loyalty plugin"
```

## CLI reference

```
po-genie [OPTIONS]

  -i, --input       (required) Path to source .po or .pot file
  -l, --locale      (required) Target locale(s), comma-separated (e.g. nl_NL or nl_NL,de_DE)
  -o, --output      Output path (default: <input-dir>/<name>-<locale>.po)
  -m, --model       OpenRouter model ID (default: anthropic/claude-3.5-haiku)
  -c, --context     Project context sent to the AI for better quality
  --batch-size      Strings per AI request (default: 40)
  --all-strings     Re-translate everything, not just missing entries
```

### Output path behaviour

| Input | Locale | Output |
|---|---|---|
| `messages.pot` | `nl_NL` | `messages-nl_NL.po` (same dir) |
| `messages-nl_NL.po` | `nl_NL` | `messages-nl_NL.po` (in-place) |
| any | any | path from `--output` flag |

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

**4. Compile to `.mo`:**

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
  onProgress: ({ locale, translated, total }) => {
    console.log(`${locale}: ${translated}/${total}`)
  },
})
// results: Array<{ locale, output, translated, skipped }>
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `input` | `string` | — | Path to source `.po` or `.pot` file |
| `locale` | `string \| string[]` | — | Target locale(s) |
| `output` | `string` | auto | Output file path |
| `model` | `string` | `anthropic/claude-3.5-haiku` | OpenRouter model ID |
| `apiKey` | `string` | `OPENROUTER_API_KEY` env | OpenRouter API key |
| `context` | `string` | — | Project description for the AI |
| `batchSize` | `number` | `40` | Strings per request |
| `onlyMissing` | `boolean` | `true` | Skip already-translated entries |
| `onProgress` | `function` | — | Progress callback |

## Variable detection

The following patterns are detected, tokenised before translation, and restored after:

| Pattern | Example |
|---|---|
| Handlebars / custom | `{{credits}}`, `{{credits_currency}}` |
| Printf | `%s`, `%d`, `%f` |
| Positional printf | `%1$s`, `%2$d` |
| Python-style | `%(name)s` |
| Single-brace | `{variable}` |

## Model recommendations

| Model | Cost | Quality | Good for |
|---|---|---|---|
| `google/gemini-2.0-flash-001` | ~$0.10/1M | ⭐⭐⭐⭐ | Best cost/quality for most projects |
| `anthropic/claude-3.5-haiku` | ~$0.80/1M | ⭐⭐⭐⭐⭐ | Higher quality, great for nuanced copy |
| `meta-llama/llama-3.3-70b-instruct` | Free tier | ⭐⭐⭐ | Budget option |

## License

MIT
