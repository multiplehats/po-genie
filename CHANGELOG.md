# po-genie

## 0.4.1

### Patch Changes

- Retranslate fuzzy entries, and recover batches broken by typographic quotes. ([#7](https://github.com/multiplehats/po-genie/pull/7))

  - An entry flagged `fuzzy` (for example after `msgmerge` matched changed source text to an old translation) is now translated even though it already has text. Entries with a current translation are still skipped and never sent to the model. A successful run removes the `fuzzy` flag and the `#|` previous-source comments and keeps other flags such as `php-format`. A failed run leaves the file untouched.
  - When a model returns the translations as a JSON-encoded string and a translation contains an unescaped quote (as with German, Czech or Polish „…" quotes), the batch is recovered instead of failing every retry. The item count and protected-token checks still apply, so anything that cannot be split safely fails as before.

## 0.4.0

### Minor Changes

- Support every locale your catalog defines and recover from malformed model output. ([#5](https://github.com/multiplehats/po-genie/pull/5))

  - Locales outside the built-in plural registry (for example `zh_CN`, `ar`, `hi_IN`, `id_ID`) now translate when the input catalog carries a valid `Plural-Forms` header and a `Language` header for that locale. The built-in registry still wins when it knows the locale.
  - A model response that returns the `translations` array JSON-encoded as a string is accepted.
  - "Response did not match schema" errors are retried like transient provider errors (up to 3 attempts).
  - Failure reasons now say when a locale has no known plural rules (with how to fix it) or when the model kept returning the wrong format, instead of an empty reason.

## 0.3.1

### Patch Changes

- Ignore spurious empty AI response items and show safe validation or HTTP-status details when a locale translation fails. ([#3](https://github.com/multiplehats/po-genie/pull/3))

## 0.3.0

### Minor Changes

- Translate every required gettext plural form and write authoritative target-locale metadata while preserving message context and completed translation slots. ([`cf932ab`](https://github.com/multiplehats/po-genie/commit/cf932ab0d6195f0244ad0ca711c5b95a0de32b20))

- Resume interrupted PO and readme translations from identity-checked checkpoints, preserve known paid usage, and replace outputs atomically. ([`cf932ab`](https://github.com/multiplehats/po-genie/commit/cf932ab0d6195f0244ad0ca711c5b95a0de32b20))

- Route multi-locale outputs safely, bound locale concurrency, preserve requested result order, and expose partial outcomes through `LocaleTranslationError`. ([`cf932ab`](https://github.com/multiplehats/po-genie/commit/cf932ab0d6195f0244ad0ca711c5b95a0de32b20))

### Patch Changes

- Validate batch sizes, response counts, variables, HTML, Markdown links, URLs, and inline code before accepting translated output. ([`cf932ab`](https://github.com/multiplehats/po-genie/commit/cf932ab0d6195f0244ad0ca711c5b95a0de32b20))

## 0.2.0

### Minor Changes

- Add WordPress readme.txt translation support ([`e66fb25`](https://github.com/multiplehats/po-genie/commit/e66fb255b8b4cf58ad3cd0a7b6c139ccafc4d570))

  po-genie can now translate WordPress plugin `readme.txt` files into any locale. The output follows the wp.org convention (`readme-nl_NL.txt`, `readme-fr_FR.txt`, etc.) so translated readmes are picked up automatically by the plugin directory.

  **What gets translated:** short description, body text, FAQ questions and answers, screenshot captions, changelog entries, bullet and numbered list items, and subsection headings.

  **What stays untouched:** plugin name, metadata (Contributors, Tags, Requires at least, etc.), `== Section ==` headers, version numbers, URLs, code blocks, and blank lines.

  Usage:

  ```bash
  po-genie -i readme.txt -l nl_NL,de_DE,fr_FR -c "WordPress translation plugin"
  ```
