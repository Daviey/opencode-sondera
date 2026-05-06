# ADR-007: Bun.spawn stdin API

Date: 2025-03

## Context

The plugin writes JSON to the adapter's stdin via `Bun.spawn`. Bun's subprocess API differs from the Web Streams API in opencode's runtime.

## Decision

Use the `FileSink` API directly:

```typescript
proc.stdin.write(data)  // works
proc.stdin.end()        // works
```

Do not use:

```typescript
proc.stdin.getWriter()  // TypeError: not a function
```

`getWriter()` works in standalone Bun scripts but not in opencode's Bun runtime.

## Consequences

This is a Bun-specific constraint that affects anyone writing opencode plugins that spawn subprocesses. The bundled plugin uses `FileSink` throughout.
