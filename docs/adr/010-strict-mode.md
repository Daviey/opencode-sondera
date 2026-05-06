# ADR-010: Strict Mode (Fail-Closed)

Date: 2025-03

## Context

The default fail-open design (ADR-002) prioritizes availability. In some contexts, security is more important. CI pipelines, shared workstations, and production-adjacent development should block tool calls if the policy engine is unreachable.

## Decision

`SONDERA_STRICT=1` changes three failure modes:

1. Harness unreachable at startup: instead of disabling enforcement and allowing all calls, the plugin blocks all calls (the `getClient()` returns null, and strict-mode checks in `tool.execute.before` throw on every call).
2. Adjudication fails mid-session: instead of logging and allowing, the plugin throws, blocking the tool call.
3. Policy deny: unchanged (always blocks).

Strict mode does not affect allow patterns. Tool calls matching an allow pattern still skip adjudication entirely, even in strict mode. This is intentional: allow patterns represent trusted operations that the user has explicitly opted out of policy enforcement for.

## Consequences

Strict mode trades availability for security. Use it in environments where policy enforcement is mandatory.
