# Cedar Policy Pipeline

The harness evaluates each event against roughly 70 Cedar policies organized in files.

## Policy files

- `base.cedar`: default permit, shell injection, obfuscation, exfiltration, web fetch security
- `destructive.cedar`: rm -rf, git force push, docker prune, database drop, etc.
- `file.cedar`: path traversal, credential access, secret writing
- `ifc.cedar`: information flow control based on data sensitivity labels
- `supply_chain_risk.cedar`: package installation attacks, dependency confusion

## Evaluation context

Policies use context from three sources:

1. YARA signatures: severity levels and categories matched against command content
2. Ollama classifiers: data sensitivity label (Public/Internal/Confidential/HighlyConfidential) and code compliance assessment. Both fall back to safe defaults when Ollama is not running.
3. Trajectory state: taint tracking, step count, and prior decisions within the session

## Policy loading

The harness server loads policies from a directory at startup via `--policy-path`. The policy set is fixed for the lifetime of the server process. Per-request policy overlays are not supported by the current harness API.

To use custom policies per project, run a separate harness instance with a different policy directory and socket path.
