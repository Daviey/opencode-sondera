# ADR-011: Allow Patterns for Selective Bypass

Date: 2025-03

## Context

Not every tool call needs policy evaluation. Frequent read-only operations like `git status`, `ls`, and `glob` add latency without security benefit. Teams working in specific domains may have their own safe commands.

## Decision

`SONDERA_ALLOW_PATTERNS` accepts comma-separated regex patterns. When a tool call matches any pattern, adjudication is skipped entirely. The regex is tested against a space-joined string of the tool name and extracted args (`command`, `path`, `url`, `pattern`, `query`).

Patterns come from two sources: the `SONDERA_ALLOW_PATTERNS` env var and the `allowPatterns` array in project config. Both are merged; invalid regexes are logged and skipped.

## Consequences

This is a local trust decision, not a policy bypass. The user (or project config) decides which operations are safe to skip. The harness never sees these calls. Matched calls are recorded as bypassed in session metrics.
