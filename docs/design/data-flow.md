# Data Flow

```
  opencode session
       |
       | tool call (bash, read, edit, write, webfetch, etc.)
       v
  +---------------------------------------------+
  | SonderaPlugin (TypeScript, in-process)      |
  | Installed via npm, curl, or plugins/ dir    |
  |                                             |
  | tool.execute.before hook:                   |
  |   1. Guard against undefined output.args    |
  |   2. Normalize tool name to Sondera action  |
  |   3. Extract tool-specific args             |
  |   4. Build AdapterRequest JSON              |
  |   5. Write NDJSON line to stream stdin      |
  |   6. Read NDJSON line from stream stdout    |
  |   7. If deny: send toast, throw error       |
  |   8. If escalate: send toast, allow         |
  |   9. If allow: proceed                      |
  |                                             |
  | tool.execute.after hook:                    |
  |   Same flow, but never blocks.              |
  |   Sends observation event for logging.      |
  +------------------+--------------------------+
                     | persistent Bun.spawn process (stream mode)
                     | falls back to one-shot spawns if unsupported
                     v
  +---------------------------------------------+
  | sondera-opencode-adapter (Rust binary)      |
  | ~/.local/bin/sondera-opencode-adapter       |
  |                                             |
  | Subcommands:                                |
  |   health: connect, check socket             |
  |   stream: persistent NDJSON stdin/stdout,   |
  |     reuses harness connection across calls  |
  |   adjudicate: one-shot JSON stdin/stdout    |
  +------------------+--------------------------+
                     | tarpc RPC over Unix socket (persistent)
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

The plugin runs in opencode's Bun process. It does not spawn a separate Node/Bun server. The only subprocess is the adapter binary, which the plugin manages via `Bun.spawn`.

User-facing events (deny, escalation, dry-run warnings, harness unavailability) surface as toast notifications via `POST /tui/show-toast` on opencode's local HTTP server. Non-user-facing errors (adapter crashes, invalid responses) go to `console.error` for debug logging.
