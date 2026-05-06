# ADR-002: Fail-Open Design

Date: 2025-03

## Context

The plugin sits between opencode and every tool call. Any failure in the plugin could block all tool execution.

## Decision

Default to `allow` on any error. Only an explicit `deny` from the harness blocks execution.

This is a security overlay, not a security gate. If the harness is down, the user loses defense-in-depth but opencode remains functional. This matches how other Sondera integrations (Claude Code, Cursor) behave.

Error cases that default to allow: adapter binary not found, adapter exits non-zero (harness error, connection refused), adapter returns invalid JSON, `Bun.spawn` throws, harness server unreachable at startup (plugin disables itself entirely).

## Consequences

A compromised harness server could be killed to bypass policy. This is acceptable because the threat model assumes the user controls their local machine. The harness protects against malicious AI actions, not against the user themselves.

Strict mode (`SONDERA_STRICT=1`, ADR-010) reverses this for environments where policy enforcement is mandatory.
