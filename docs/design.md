# Design: How It Works

| Section | Description |
|---------|-------------|
| [Data Flow](design/data-flow.md) | End-to-end path from opencode tool call to harness and back |
| [Initialization Flow](design/initialization-flow.md) | What happens when the plugin loads and on first tool call |
| [Tool Normalization](design/tool-normalization.md) | How opencode tools map to Sondera action types |
| [Cedar Policy Pipeline](design/cedar-policy-pipeline.md) | How the harness evaluates policies |
| [Adapter Protocol](design/adapter-protocol.md) | Health, stream, and oneshot subcommands |
| [Dry Run Mode](design/dry-run-mode.md) | Shadow mode policy evaluation |
| [Allow Patterns](design/allow-patterns.md) | Regex-based selective bypass |
| [Audit Log](design/audit-log.md) | JSONL adjudication trail |
| [Metrics](design/metrics.md) | Per-session counters and latency tracking |
| [Example Policies](design/example-policies.md) | What the default policies block and how to write custom ones |
