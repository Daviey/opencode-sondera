# Initialization Flow

```
opencode starts
    |
    v
Plugin loaded (via npm, curl to plugins/ dir, or .opencode/plugins/)
    |
    v
SonderaPlugin() called with { directory, serverUrl }
    |
    v
loadConfig(directory):
  - Read .opencode/sondera.json or sondera.json (if present)
  - Env vars override project config values
  - Compile allow patterns from both sources
  - Return SonderaConfig
    |
    v
initToast(serverUrl):
  - Store opencode server origin for toast notifications
    |
    v
First tool.execute.before or .after call
    |
    v
getClient() (first call only):
  - config.enabled=false? -> return null (disabled)
  - Spawn adapter with "health" subcommand
      - exit 0 -> create HarnessClient, store singleton
         - initAuditLog() if config.auditLogPath set
      - exit non-zero or throw:
         - strict mode: send error toast, return null (all calls will block)
         - default: send warning toast, return null (all calls allowed)
  - Subsequent calls return cached client
    |
    v
Per tool call:
  - output.args missing or null? -> return (skip, fail-open)
  - matchesAllowPattern()? -> recordBypass(), skip harness
  - Send to harness via client.adjudicate()
  - On error:
      - strict mode: send error toast, throw (block tool call)
      - default: console.error AdjudicationError, allow
  - On deny:
      - dry run: send warning toast, allow
      - default: send error toast, throw PolicyDenyError (block)
  - On escalate: send warning toast, allow
  - On allow: proceed
  - writeAudit() for every adjudication
  - recordAllow/deny/escalate/error metrics
```

The adapter binary path is resolved at client construction time (see [ADR-006](../adr/006-adapter-binary-path-resolution.md)). The health check runs once; the client is reused for all subsequent adjudications.
