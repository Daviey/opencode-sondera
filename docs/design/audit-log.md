# Audit Log

`SONDERA_AUDIT_LOG` writes one JSONL line per adjudication to the given path.

## Entry format

```json
{
  "ts": "2026-05-06T17:30:00.000Z",
  "trajectory_id": "session-abc",
  "tool": "bash",
  "action": "ShellCommand",
  "decision": "deny",
  "reason": "destructive command blocked",
  "dry_run": false,
  "duration_ms": 12.34
}
```

Fields: timestamp, trajectory ID, tool name, action type, decision, reason (null if absent), dry-run flag, and round-trip duration in milliseconds.

## Implementation

The log is opened once at plugin initialization using `Bun.file().writer()` and flushed after each write. If the file cannot be opened, the plugin logs an error and continues without audit logging.

The log is not rotated. That is the user's responsibility. The format is structured for downstream analysis with `jq`, spreadsheet import, or log aggregation.
