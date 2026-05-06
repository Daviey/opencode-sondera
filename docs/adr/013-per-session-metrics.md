# ADR-013: Per-Session Metrics

Date: 2025-03

## Context

Teams need visibility into how often policies are triggering without digging through audit logs.

## Decision

Track counters (total, allowed, denied, escalated, dry-run denies, bypassed, errors) and cumulative latency across the session. A summary is logged when opencode exits.

This gives teams a quick sanity check: if the deny count is zero after a long session, policies may be too permissive. If the bypass count is high, allow patterns may be too broad.

## Consequences

Metrics are module-level state, reset between sessions via `_reset()`. The `getMetrics()` export is available for programmatic access. No persistent storage; metrics are ephemeral.
