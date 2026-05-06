# Architecture Decision Records

## ADR-001: Two-Part Bridge (TypeScript Plugin + Rust Adapter)

opencode's plugin system runs JavaScript/TypeScript via Bun. The Sondera harness server communicates over tarpc (a Rust-specific RPC framework) via Unix domain sockets.

There is no JavaScript tarpc client. The harness RPC protocol uses Rust-specific binary serialization. A TypeScript plugin cannot talk directly to the harness server.

We split the integration into two parts:

1. A TypeScript opencode plugin that hooks tool calls and normalizes events
2. A Rust adapter binary that bridges stdin/stdout JSON to the harness tarpc socket

```
opencode -> plugin (TS) -> Bun.spawn -> adapter (Rust) -> tarpc -> harness server
```

Alternatives we considered and rejected:

HTTP/REST wrapper around the harness: would require modifying the upstream sondera-coding-agent-hooks repo. We want to work with the existing harness without upstream changes.

FFI/WebAssembly: could compile a Rust tarpc client to Wasm and call it from JS. Rejected because tarpc uses tokio/unix sockets heavily, which don't play well with Wasm. Also Bun doesn't support Wasm modules with async I/O.

Node native addon: would require compiling a Rust `.node` binary. Rejected because opencode uses Bun, not Node, and Bun's native addon support is limited.

Each tool call spawns a subprocess (the adapter binary). This adds roughly 20-50ms latency per call. Acceptable because Cedar policy evaluation itself takes longer, and tool calls are already network-bound.


## ADR-002: Fail-Open Design

The plugin sits between opencode and every tool call. Any failure in the plugin could block all tool execution.

We default to `allow` on any error. Only an explicit `deny` from the harness blocks execution.

This is a security overlay, not a security gate. If the harness is down, the user loses defense-in-depth but opencode remains functional. This matches how other Sondera integrations (Claude Code, Cursor) behave.

Error cases that default to allow: adapter binary not found, adapter exits non-zero (harness error, connection refused), adapter returns invalid JSON, `Bun.spawn` throws, harness server unreachable at startup (plugin disables itself entirely).

The tradeoff: a compromised harness server could be killed to bypass policy. This is acceptable because the threat model assumes the user controls their local machine. The harness protects against malicious AI actions, not against the user themselves.


## ADR-003: Stdin/Stdout JSON Protocol

The adapter binary needs a simple, language-agnostic way to receive events and return adjudications.

We use newline-delimited JSON over stdin/stdout. The adapter takes a subcommand (`health` or `adjudicate`), reads one JSON object from stdin, and writes one JSON object to stdout.

Why not other protocols:

HTTP localhost: adds port management, CORS, and network exposure. A Unix socket via a subprocess is simpler and more secure.

gRPC/protobuf: would add a heavy dependency for a single-method API.

Long-running daemon: would require lifecycle management (start, stop, health checks, restart on crash). One-shot subprocesses are simpler; the OS handles cleanup.

Each adjudication spawns a new process. The adapter connects to the harness Unix socket, sends one RPC, and exits. Clean process boundary, no state leaks between calls.


## ADR-004: Single-File Bundled Plugin

opencode auto-loads all `.ts` files from `~/.config/opencode/plugins/`. The plugin source is split across 4 files (`index.ts`, `client.ts`, `normalize.ts`, `types.ts`).

If all 4 files are placed directly in `plugins/`, opencode tries to load each one as a plugin. Only `index.ts` exports a plugin; the others are modules. This causes errors or duplicate loads.

Options:

1. Put files in a subdirectory `plugins/sondera/`. Unclear whether opencode recursively loads from subdirs.
2. Create a single self-contained `.ts` file with everything inlined.
3. Use npm package imports.

We went with option 2. `sondera-bundled.ts` is a single file containing all types, client logic, normalization, and the plugin export.

Changes to `src/` must be synced to `sondera-bundled.ts`. The bundled file is around 300 lines, which is manageable. The multi-file `src/` version exists for development and testing.


## ADR-005: Ollama Graceful Degradation

The Sondera harness uses Ollama (a local LLM) for two classifiers: data sensitivity labeling (Public/Internal/Confidential/HighlyConfidential) and secure code policy evaluation (compliant/violating). When Ollama is not running, these classifiers fail.

Original behavior: the harness propagated Ollama errors as fatal, causing the entire adjudication to fail. The adapter returned exit code 1, and the plugin defaulted to `allow` (fail-open). Every tool call produced an error log.

Patched behavior: the harness catches Ollama errors and falls back to safe defaults. Data sensitivity defaults to `Public` (least restrictive label). Secure code policy defaults to `compliant` (no violations detected).

Cedar policies and YARA signature scanning work without Ollama. They are deterministic and don't require an LLM. The LLM classifiers add defense-in-depth but are not required for basic protection. Users should not need to run Ollama to get value from Sondera.

The fix adds `classify_graceful()` and `evaluate_policy_graceful()` helper methods in `transform.rs` that catch errors and return defaults, replacing 16 direct `data_model.classify()` and `policy_model.evaluate_content()` call sites.


## ADR-006: Adapter Binary Path Resolution

The plugin needs to find the adapter binary. On NixOS, `~/.local/bin` is typically not on `PATH`, and the binary links against Nix store OpenSSL.

The plugin checks these locations in order:

1. `SONDERA_ADAPTER_PATH` environment variable (explicit override)
2. `$HOME/.local/bin/sondera-opencode-adapter` (default install location)
3. `sondera-opencode-adapter` (relies on PATH)

The release binary built inside nix-shell has RPATH baked in, so it works outside nix-shell. Users can install it to `~/.local/bin` without modifying their PATH; the plugin checks there explicitly.


## ADR-007: Bun.spawn stdin API

The plugin writes JSON to the adapter's stdin via `Bun.spawn`.

Bun's subprocess API differs from the Web Streams API. `proc.stdin` is a `FileSink`, not a `WritableStream`. The correct API is:

```typescript
proc.stdin.write(data)  // works
proc.stdin.end()        // works

proc.stdin.getWriter()  // TypeError: not a function
```

This was discovered during live testing. `getWriter()` works in standalone Bun scripts but not in opencode's Bun runtime. The bundled plugin uses the `FileSink` API directly.


## ADR-008: Persistent Stream Process vs One-Shot Spawns

Each tool call used to spawn a new adapter subprocess (oneshot mode). This added 20-50ms overhead per call from process creation, tarpc connection setup, and OS pipe teardown.

The adapter now supports a `stream` subcommand that reads NDJSON from stdin and writes NDJSON to stdout over a single persistent connection to the harness server. The TS client keeps this process alive across tool calls.

The client tries stream mode on the first adjudicate call. If the adapter binary does not support the `stream` command (old binary), the process exits immediately and the client falls back to oneshot mode for all future calls. This detection happens once and the choice is cached.

Benefits: eliminates per-call spawn overhead, reuses the tarpc Unix socket connection, reduces latency from ~50ms to the time for a single tarpc round trip.

Tradeoffs:

Concurrent calls must be serialized because the NDJSON protocol is line-based and the persistent process handles one request at a time. The client uses a promise chain to serialize. This is acceptable because tool calls are already sequential in practice (opencode dispatches them one at a time).

Process lifecycle: if the stream process crashes (harness server restarts, OOM, etc.), the client detects the dead process and spawns a new one on the next call. The exited promise handler invalidates the cached process reference. The `ensureStreamProcess` method checks `exitCode === null` before reusing.

The oneshot path is preserved for tests (`forceOneshot` constructor parameter) and as a fallback for old adapter binaries. It is also used if the stream process repeatedly fails.
