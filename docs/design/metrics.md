# Metrics

The plugin tracks per-session counters and cumulative latency.

## Counters

- `total`: all adjudicated calls
- `allowed`: harness returned allow
- `denied`: harness returned deny
- `escalated`: harness returned escalate
- `dryRunDenies`: harness returned deny in dry-run mode
- `bypassed`: matched an allow pattern, skipped harness
- `errors`: adjudication threw an exception

## Latency

`totalDurationMs` accumulates the wall-clock time of each adjudication (from before the `adjudicate()` call to after the response). The session summary computes average latency.

## Output

A summary is logged via `console.log` when opencode exits. The `getMetrics()` export returns a snapshot for programmatic access. Metrics are ephemeral: module-level state, reset between sessions via `_reset()`.

Interpretation guide:
- Zero denies after a long session suggests policies may be too permissive
- High bypass count suggests allow patterns may be too broad
- Rising error count suggests adapter or harness instability
