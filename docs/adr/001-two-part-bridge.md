# ADR-001: Two-Part Bridge (TypeScript Plugin + Rust Adapter)

Date: 2025-03

## Context

opencode's plugin system runs JavaScript/TypeScript via Bun. The Sondera harness server communicates over tarpc (a Rust-specific RPC framework) via Unix domain sockets.

There is no JavaScript tarpc client. The harness RPC protocol uses Rust-specific binary serialization. A TypeScript plugin cannot talk directly to the harness server.

## Decision

Split the integration into two parts:

1. A TypeScript opencode plugin that hooks tool calls and normalizes events
2. A Rust adapter binary that bridges stdin/stdout JSON to the harness tarpc socket

```
opencode -> plugin (TS) -> Bun.spawn -> adapter (Rust) -> tarpc -> harness server
```

## Alternatives considered

HTTP/REST wrapper around the harness: would require modifying the upstream sondera-coding-agent-hooks repo. We want to work with the existing harness without upstream changes.

FFI/WebAssembly: could compile a Rust tarpc client to Wasm and call it from JS. Rejected because tarpc uses tokio/unix sockets heavily, which don't play well with Wasm. Also Bun doesn't support Wasm modules with async I/O.

Node native addon: would require compiling a Rust `.node` binary. Rejected because opencode uses Bun, not Node, and Bun's native addon support is limited.

## Consequences

Each tool call spawns a subprocess (the adapter binary). This adds roughly 20-50ms latency per call. Acceptable because Cedar policy evaluation itself takes longer, and tool calls are already network-bound. ADR-008 later addresses this with a persistent stream process.
