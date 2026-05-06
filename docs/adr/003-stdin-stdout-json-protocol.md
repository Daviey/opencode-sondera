# ADR-003: Stdin/Stdout JSON Protocol

Date: 2025-03

## Context

The adapter binary needs a simple, language-agnostic way to receive events and return adjudications.

## Decision

Use newline-delimited JSON over stdin/stdout. The adapter takes a subcommand (`health`, `adjudicate`, or `stream`), reads JSON from stdin, and writes JSON to stdout.

## Alternatives considered

HTTP localhost: adds port management, CORS, and network exposure. A Unix socket via a subprocess is simpler and more secure.

gRPC/protobuf: would add a heavy dependency for a single-method API.

Long-running daemon: would require lifecycle management (start, stop, health checks, restart on crash). One-shot subprocesses are simpler; the OS handles cleanup.

## Consequences

Each adjudication in oneshot mode spawns a new process. The adapter connects to the harness Unix socket, sends one RPC, and exits. Clean process boundary, no state leaks between calls. Stream mode (ADR-008) later adds a persistent variant.
