# Allow Patterns

`SONDERA_ALLOW_PATTERNS` accepts comma-separated regex patterns. Matched tool calls skip the harness entirely, saving the round-trip. The regex is tested against a space-joined string of the tool name and extracted args (`command`, `path`, `url`, `pattern`, `query`).

Patterns come from two sources: the `SONDERA_ALLOW_PATTERNS` env var and the `allowPatterns` array in project config (`.opencode/sondera.json` or `sondera.json`). Both are merged. Invalid regexes are logged and skipped so a single bad pattern does not break the plugin.

Examples:

```
"git status"          skip adjudication for git status commands
"\\bglob\\b"          skip all glob operations
"https://docs\\.example\\.com"  allow specific domains
```

Matched calls increment the bypass counter in session metrics. The harness never sees these calls. This is a local trust decision, not a policy bypass.
