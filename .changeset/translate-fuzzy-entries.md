---
"po-genie": patch
---

Retranslate fuzzy entries, and recover batches broken by typographic quotes.

- An entry flagged `fuzzy` (for example after `msgmerge` matched changed source text to an old translation) is now translated even though it already has text. Entries with a current translation are still skipped and never sent to the model. A successful run removes the `fuzzy` flag and the `#|` previous-source comments and keeps other flags such as `php-format`. A failed run leaves the file untouched.
- When a model returns the translations as a JSON-encoded string and a translation contains an unescaped quote (as with German, Czech or Polish „…" quotes), the batch is recovered instead of failing every retry. The item count and protected-token checks still apply, so anything that cannot be split safely fails as before.
