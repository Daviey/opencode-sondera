# ADR-024: Adjudication Timeout

## Status

Accepted

## Context

When the harness server is slow to respond (e.g., Ollama LLM classification taking 20+ seconds on CPU, or harness process hung), adjudication calls block indefinitely. This stalls opencode's tool execution and degrades the user experience. The harness has no built-in per-request timeout.

## Decision

Add a configurable timeout (`adjudicateTimeoutMs`, default 5000ms) that applies to both the oneshot and stream adjudication paths. When the timeout fires:

1. On the oneshot path: kill the adapter subprocess and return `{ decision: "allow" }`
2. On the stream path: kill the stream process and fall through to error handling (which may retry via oneshot)

The timeout is configurable via `SONDERA_ADJUDICATE_TIMEOUT_MS` env var or `adjudicateTimeoutMs` in project config.

## Consequences

- Adjudication calls never block longer than the configured timeout
- Default of 5 seconds is generous enough for Cedar-only evaluation (sub-second) but catches Ollama hangs
- Fail-open on timeout matches the existing error handling philosophy
- Stream process is killed on timeout, so the next adjudication starts a fresh stream connection
- Users with fast Ollama instances can increase the timeout; users without Ollama get fast fail-open
