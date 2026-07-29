# po-genie

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
