---
"po-genie": minor
---

Support every locale your catalog defines and recover from malformed model output.

- Locales outside the built-in plural registry (for example `zh_CN`, `ar`, `hi_IN`, `id_ID`) now translate when the input catalog carries a valid `Plural-Forms` header and a `Language` header for that locale. The built-in registry still wins when it knows the locale.
- A model response that returns the `translations` array JSON-encoded as a string is accepted.
- "Response did not match schema" errors are retried like transient provider errors (up to 3 attempts).
- Failure reasons now say when a locale has no known plural rules (with how to fix it) or when the model kept returning the wrong format, instead of an empty reason.
