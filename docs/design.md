# Design: How It Works

## Data Flow

```
  opencode session
       |
       | tool call (bash, read, edit, write, webfetch, etc.)
       v
  +---------------------------------------------+
  | SonderaPlugin (TypeScript, in-process)      |
  | ~/.config/opencode/plugins/sondera.ts       |
  |                                             |
  | tool.execute.before hook:                   |
  |   1. Normalize tool name to Sondera action  |
  |   2. Extract tool-specific args             |
  |   3. Build AdapterRequest JSON              |
  |   4. Spawn adapter binary                   |
  |   5. Write JSON to stdin                    |
  |   6. Read JSON from stdout                  |
  |   7. If deny: throw Error (blocks tool)     |
  |   8. If escalate: log warning               |
  |   9. If allow: proceed                      |
  |                                             |
  | tool.execute.after hook:                    |
  |   Same flow, but never blocks.              |
  |   Sends observation event for logging.      |
  +------------------+--------------------------+
                     | Bun.spawn (subprocess)
                     v
  +---------------------------------------------+
  | sondera-opencode-adapter (Rust binary)      |
  | ~/.local/bin/sondera-opencode-adapter       |
  |                                             |
  | Subcommands:                                |
  |   health: connect, check socket             |
  |   adjudicate: read JSON stdin,              |
  |     connect to harness via                  |
  |     tarpc Unix socket,                      |
  |     write JSON stdout                       |
  +------------------+--------------------------+
                     | tarpc RPC over Unix socket
                     v
  +---------------------------------------------+
  | sondera-harness-server (Rust daemon)        |
  | ~/.sondera/sondera-harness.sock             |
  |                                             |
  | Per tool call:                              |
  |   1. Receive Event via tarpc                |
  |   2. Store event in trajectory DB           |
  |   3. YARA signature scan on content         |
  |   4. Ollama data sensitivity classify       |
  |      (graceful fallback to Public)          |
  |   5. Ollama secure code policy eval         |
  |      (graceful fallback to compliant)       |
  |   6. Build Cedar authorization request      |
  |   7. Evaluate against Cedar policies        |
  |   8. Return Adjudicated (allow/deny)        |
  +---------------------------------------------+
```

## Initialization Flow

```
opencode starts
    |
    v
Plugin loaded from ~/.config/opencode/plugins/sondera.ts
    |
    v
SonderaPlugin() called with { directory }
    |
    v
First tool.execute.before or .after call
    |
    v
getClient() (first call only):
  - SONDERA_ENABLED=false? -> return null (disabled)
  - Spawn adapter with "health" subcommand
      - exit 0 -> create HarnessClient, store singleton
      - exit non-zero or throw -> warn, return null
  - Subsequent calls return cached client
```

## Tool Normalization

opencode tools are mapped to Sondera action types with tool-specific argument extraction:

| opencode tool | Sondera action | Extracted args |
|---|---|---|
| `bash` | `ShellCommand` | `command`, `workdir` |
| `read` | `FileRead` | `path` (from `filePath` or `path`) |
| `edit` | `FileEdit` | `path`, `old_content`, `new_content` |
| `write` | `FileWrite` | `path`, `content` |
| `apply_patch` | `FileEdit` | `patch_text` |
| `glob` | `FileSearch` | `pattern` |
| `grep` | `ContentSearch` | `pattern`, `include` |
| `webfetch` | `WebFetch` | `url`, `format` |
| `task` | `SubAgent` | (raw args) |
| `skill` | `SkillLoad` | (raw args) |
| `todowrite` | `TodoUpdate` | (raw args) |
| (any other) | `ToolCall` | (raw args passed through) |

## Cedar Policy Pipeline

The harness evaluates each event against roughly 70 Cedar policies organized in files:

- `base.cedar`: default permit, shell injection, obfuscation, exfiltration, web fetch security
- `destructive.cedar`: rm -rf, git force push, docker prune, database drop, etc.
- `file.cedar`: path traversal, credential access, secret writing
- `ifc.cedar`: information flow control based on data sensitivity labels
- `supply_chain_risk.cedar`: package installation attacks, dependency confusion

Policies use context from YARA signatures (severity, categories), Ollama classifiers (sensitivity label, compliance), and trajectory state (taint tracking, step count).

## Adapter Protocol

### Health check

```
$ sondera-opencode-adapter health
{"status":"ok"}
```

Exit 0 means healthy, non-zero means unreachable.

### Adjudication

```
$ echo '<json>' | sondera-opencode-adapter adjudicate
<json response>
```

Request (stdin):
```json
{
  "trajectory_id": "session-id",
  "agent_id": "opencode-username",
  "tool": "bash",
  "action": "ShellCommand",
  "args": { "command": "ls", "workdir": "/tmp" },
  "cwd": "/home/user/project",
  "event_type": "before"
}
```

Response (stdout):
```json
{
  "decision": "allow",
  "reason": null,
  "annotations": [
    { "policy_id": "default-permit", "description": "Permit all actions..." }
  ]
}
```

`decision` is one of: `allow`, `deny`, `escalate`.
