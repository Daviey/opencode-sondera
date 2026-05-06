# ADR-016: Defensive output.args Guard

Date: 2026-05

## Context

The sondera plugin's `tool.execute.before` hook receives `input` and `output` parameters from opencode. In practice, `output.args` can be `undefined` or `null` depending on the tool call and opencode version. The original code accessed `output.args` without checking, producing `undefined is not an object (evaluating 'args.filePath')` errors that cascaded and broke all subsequent tool calls in the session.

## Decision

Add a guard at the top of `tool.execute.before`:

```typescript
if (!output || typeof output.args !== "object" || output.args === null) return
```

This causes the plugin to silently skip adjudication for tool calls with malformed output, rather than throwing and potentially corrupting the tool call pipeline.

Additional defensive changes:
- `output.args ?? {}` when passing to `toolArgs()`
- `input.sessionID ?? input.sessionId` to handle both casings opencode uses
- `(input.args ?? output?.args) ?? {}` in the `after` hook
- `getClient()` wrapped in try/catch so initialization errors never propagate

## Consequences

The plugin no longer crashes on unexpected tool call shapes. When the guard triggers, the tool call proceeds without policy evaluation (consistent with fail-open design).
