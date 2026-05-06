# ADR-012: JSONL Audit Log

Date: 2025-03

## Context

For compliance and debugging, teams need a record of every adjudication.

## Decision

Write one JSONL line per tool call to a configurable path (`SONDERA_AUDIT_LOG`). Each entry includes: timestamp, trajectory ID, tool, action, decision, reason (if any), dry-run flag, and round-trip duration in milliseconds.

The log is opened once at plugin initialization using `Bun.file().writer()` and flushed after each write. If the file cannot be opened, the plugin logs an error and continues without audit logging. The log is not rotated; that is the user's responsibility.

## Consequences

The format is structured for downstream analysis with `jq`, spreadsheet import, or log aggregation. Dry-run entries are distinguishable from real enforcement via the `dry_run` field.
