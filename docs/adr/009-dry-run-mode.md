# ADR-009: Dry Run Mode

Date: 2025-03

## Context

Rolling out policy enforcement to existing teams is risky. Blocking tool calls without warning can disrupt workflows and erode trust.

## Decision

`SONDERA_DRY_RUN=1` sends every tool call to the harness for adjudication but does not throw on deny. Denied actions are shown as toast notifications (ADR-015) and the tool call proceeds. Audit log entries include `dry_run: true` so dry-run denials can be filtered from real enforcement later.

This lets teams run policies in shadow mode: they see what would be blocked without breaking anything. Once the deny rate is acceptable, flip dry run off.

## Consequences

The implementation adds a single branch in the deny path of `tool.execute.before`. No changes to the adapter or harness are needed.
