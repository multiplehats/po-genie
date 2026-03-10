# po-genie

AI-powered `.po` / `.pot` file translator. Fills in missing translations using any model available on [OpenRouter](https://openrouter.ai), with reliable variable detection so `{{credits}}`, `%s`, `%1$s` and friends always survive the round-trip.

## Features

- Translates untranslated `msgstr ""` entries, leaves existing translations alone
- Detects and tokenises variables before sending to the AI — they cannot be mangled
- Batches strings for efficiency (configurable batch size)
- Works with any OpenRouter model — pick the right cost/quality trade-off
- Multiple target locales in one command
- Programmatic API + CLI

## Install

```bash
npm install -g po-genie
# or use without installing
npx po-genie --help
```

## Quick start

```bash
export OPENROUTER_API_KEY=sk-or-...

# Translate a .pot file to Dutch
po-genie -i languages/messages.pot -l nl_NL

# Translate an existing .po file in-place (only fills missing strings)
po-genie -i languages/messages-nl_NL.po -l nl_NL

# Multiple locales at once
po-genie -i languages/messages.pot -l nl_NL,de_DE,fr_FR

# Specify model and project context for better quality
po-genie -i languages/messages.pot -l nl_NL \
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

## Environment variables

```bash
OPENROUTER_API_KEY=sk-or-...   # Required — your OpenRouter API key
```

A `.env` file in the current directory is automatically loaded.

## Model recommendations

| Model | Cost | Quality | Good for |
|---|---|---|---|
| `google/gemini-2.0-flash-001` | ~$0.10/1M | ⭐⭐⭐⭐ | Best cost/quality for most projects |
| `anthropic/claude-3.5-haiku` | ~$0.80/1M | ⭐⭐⭐⭐⭐ | Higher quality, great for nuanced copy |
| `meta-llama/llama-3.3-70b-instruct` | Free tier | ⭐⭐⭐ | Budget option |

## License

MIT
