# ADR-021: Adapter Oneshot Error Handling

Date: 2026-05

## Context

The adapter's `adjudicate` subcommand (oneshot mode) used `?` error propagation. When the harness server returned any error (Ollama unavailable, RPC timeout, internal error), the adapter process exited with code 1 and printed nothing to stdout. The calling TypeScript plugin then treated this as a fail-open and allowed the command.

The `stream` mode already handled errors gracefully: it caught errors, logged them to stderr, and returned `{"decision":"allow","reason":"..."}` to stdout.

## Decision

Mirror the stream mode's error handling in the oneshot `adjudicate` subcommand. Catch `Err` from `adjudicate(req).await` and return `{"decision":"allow","reason":"adjudication error: ..."}`. Also handle invalid stdin JSON the same way instead of crashing.

## Consequences

The adapter always outputs valid JSON to stdout and exits 0. This makes the fail-open behavior explicit and observable: the `reason` field in the response tells the plugin (and audit log) why the decision was allow rather than deny. The TypeScript plugin can log this reason for debugging without special-casing exit codes.
