# ADR-020: Integration Test Strategy

Date: 2026-05

## Context

The integration tests run the real harness server and adapter binary together to verify Cedar policy enforcement end-to-end. Two infrastructure problems surfaced:

1. The harness server's `default_socket_path()` prefers `/var/run/sondera/` when running as root (CI, Docker) and falls back to `~/.sondera/` otherwise. Tests that hardcoded `~/.sondera/` could not find the socket in CI.
2. The public harness server does not fully degrade when Ollama is unavailable on all platforms. On CI Ubuntu, Cedar deny evaluation fails because Ollama errors propagate through the tarpc layer. On local Docker (also no Ollama), the same requests succeed because `classify_graceful` catches the error.

## Decision

- Pass `--socket` to the harness server and set `SONDERA_SOCKET` for adapter processes to force a consistent socket path regardless of user/root context.
- Probe the harness in `beforeAll` with a known-deny command (`rm -rf /`). If the response is `deny` without a `reason` field, Cedar works without Ollama and deny tests run. If the response is `allow` with an error reason, skip deny tests gracefully.
- Use `Dockerfile.test` for local reproduction. Mount source directories and use Docker named volumes for cargo registry caching so rebuilds are fast.

## Consequences

Deny tests only run when the full pipeline (Cedar + YARA + Ollama) is available. In CI without Ollama, only infrastructure tests (health, allow, trajectory reuse) run. This is acceptable because the deny logic is tested upstream in the harness repo.
