# ADR-019: Promise Chain Serialization for Concurrent Calls

Date: 2025-03

## Context

The persistent stream process (ADR-008) reads and writes NDJSON over a single stdin/stdout pair. The protocol is strictly request-response: one line in, one line out. If two adjudicate calls run concurrently, their stdin writes and stdout reads would interleave, producing corrupted JSON and wrong responses mapped to wrong calls.

## Decision

Serialize concurrent `adjudicate()` calls using a promise chain. Each call acquires a token from the previous call's promise, awaits it, performs its work, then releases:

```typescript
async adjudicate(event) {
  const token = this.chain
  let release
  const gate = new Promise(r => { release = r })
  this.chain = gate

  await token
  try {
    return await this._adjudicate(event)
  } finally {
    release()
  }
}
```

This is a mutex pattern. `this.chain` always holds a promise representing the completion of the currently executing call. The next call awaits that promise before proceeding.

## Alternatives considered

Queue with a worker thread: would add complexity for what is in practice a sequential workload. opencode dispatches tool calls one at a time.

Skip serialization, rely on opencode being sequential: would break if opencode ever parallelizes tool calls, or if other code paths call `adjudicate()` concurrently.

## Consequences

Calls are processed in FIFO order. A slow adjudication delays subsequent calls. This is acceptable because policy evaluation is fast (single-digit milliseconds) and tool calls are already sequential in opencode.

The `forceOneshot` test parameter bypasses stream mode but still uses the same promise chain, so tests exercise the serialization logic.
