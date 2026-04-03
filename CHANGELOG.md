# po-genie

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
