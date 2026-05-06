# ADR-008: Persistent Stream Process vs One-Shot Spawns

Date: 2025-03

## Context

Each tool call spawned a new adapter subprocess (oneshot mode). This added 20-50ms overhead per call from process creation, tarpc connection setup, and OS pipe teardown.

## Decision

Add a `stream` subcommand to the adapter that reads NDJSON from stdin and writes NDJSON to stdout over a single persistent connection to the harness server. The TS client keeps this process alive across tool calls.

The client tries stream mode on the first adjudicate call. If the adapter binary does not support `stream` (old binary), the process exits immediately and the client falls back to oneshot mode for all future calls. This detection happens once and the choice is cached.

## Consequences

Eliminates per-call spawn overhead, reuses the tarpc Unix socket connection, reduces latency from ~50ms to the time for a single tarpc round trip.

Concurrent calls must be serialized because the NDJSON protocol is line-based and the persistent process handles one request at a time. The client uses a promise chain (ADR-019) to serialize. This is acceptable because tool calls are already sequential in practice (opencode dispatches them one at a time).

Process lifecycle: if the stream process crashes (harness server restarts, OOM), the client detects the dead process and spawns a new one on the next call. The `ensureStreamProcess` method checks `exitCode === null` before reusing.

The oneshot path is preserved for tests (`forceOneshot` constructor parameter) and as a fallback for old adapter binaries.
