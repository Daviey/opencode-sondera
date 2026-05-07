# ADR-023: Auto-Spawn Harness Server

## Status

Accepted

## Context

Users had to manually start the harness server before running opencode. If they forgot, the plugin would silently disable itself (fail-open mode) or block everything (strict mode). This created friction, especially for new users testing the plugin for the first time.

The harness server is a long-running process that binds to a Unix socket. It needs a path to Cedar policy files. The adapter binary already discovers the socket path via `default_socket_path()`.

## Decision

When `harnessPath` is configured (via env var `SONDERA_HARNESS_PATH` or project config), the plugin attempts to spawn the harness server on first tool call if it is not already running. The spawn logic:

1. Run health check via adapter
2. If healthy, skip spawning (harness already running)
3. Spawn harness server process with optional `--policy-path` flag
4. Poll health check up to 10 times with 500ms intervals (5 seconds total)
5. If health check passes, proceed with adjudication
6. If health check never passes, fall through to existing error handling (warn or strict block)

## Consequences

- Zero-config if harness is already running (e.g., systemd service)
- One-time config (`harnessPath` + `policiesPath`) enables fully automatic operation
- Multiple opencode instances sharing the same harness is safe (health check prevents duplicate spawns)
- Harness process lifetime is tied to opencode process; killing opencode kills the harness
- Stale socket files from previous crashes are handled by the harness server itself (it replaces the socket on startup)
