# opencode-sondera

[Sondera](https://github.com/sondera-ai/sondera-coding-agent-hooks) Cedar policy enforcement for [opencode](https://opencode.ai).

This plugin intercepts every tool call (shell commands, file reads/writes, web fetches, etc.) and sends it to the Sondera harness server for Cedar policy adjudication. Denials block execution; escalations log a warning.

## Prerequisites

- [opencode](https://opencode.ai) with plugin support
- [Sondera harness server](https://github.com/sondera-ai/sondera-coding-agent-hooks) running

## Install

### 1. Build the Rust adapter binary

**Using nix-shell (recommended):**

```bash
# Clone the sondera repo alongside this project
cd ..
git clone https://github.com/sondera-ai/sondera-coding-agent-hooks.git

# Copy the adapter app into the sondera workspace
cp -r opencode/sondera/adapter sondera-coding-agent-hooks/apps/opencode

# Build with nix-shell (provides OpenSSL etc.)
cd sondera-coding-agent-hooks
nix-shell ../opencode/sondera/shell.nix --run \
  "cargo build --bin sondera-opencode-adapter"
```

**Without nix (requires `pkg-config` and `libssl-dev`):**

```bash
cd adapter
cargo build --release
```

Then put the binary on PATH:

```bash
cp target/debug/sondera-opencode-adapter ~/.local/bin/
```

### 2. Start the harness server

```bash
cd ../sondera-coding-agent-hooks
nix-shell ../opencode/sondera/shell.nix --run \
  "./target/debug/sondera-harness-server -v"
```

### 3. Verify the connection

```bash
sondera-opencode-adapter health
# {"status":"ok"}
```

### 4. Install the plugin

**Option A: Local plugin (single file, recommended)**

Copy the bundled TypeScript file to `~/.config/opencode/plugins/` (global) or
`.opencode/plugins/` (per-project):

```bash
# Global
mkdir -p ~/.config/opencode/plugins
cp sondera-bundled.ts ~/.config/opencode/plugins/sondera.ts

# Per-project
mkdir -p .opencode/plugins
cp sondera-bundled.ts .opencode/plugins/sondera.ts
```

**Option B: Local plugin (multi-file)**

Copy the TypeScript source into `.opencode/plugins/` in your project:

```bash
mkdir -p .opencode/plugins/sondera
cp src/*.ts .opencode/plugins/sondera/
```

> **Note:** When using multi-file plugins in the auto-loaded `plugins/` directory,
> put them in a subdirectory so that non-plugin modules aren't loaded directly.

**Option C: npm package**

```json
// opencode.json
{
  "plugin": ["opencode-sondera"]
}
```

## Nix Support

A `shell.nix` and `flake.nix` are provided:

```bash
# Dev shell with all deps
nix-shell shell.nix

# Or with flakes
nix develop
```

The flake also builds the adapter binary:

```bash
nix build .#sondera-opencode-adapter
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `SONDERA_ADAPTER_PATH` | `$HOME/.local/bin/sondera-opencode-adapter` | Path to the adapter binary |
| `SONDERA_ENABLED` | `true` | Set to `false` to disable |
| `SONDERA_DRY_RUN` | `false` | Set to `1` or `true` to log denials without blocking |
| `SONDERA_ALLOW_PATTERNS` | (none) | Comma-separated regex patterns to bypass adjudication |
| `SONDERA_AUDIT_LOG` | (none) | Path to JSONL file for adjudication audit trail |

### Dry Run Mode

Set `SONDERA_DRY_RUN=1` to evaluate policies without blocking tool calls. Denied actions are logged as warnings but still execute. Useful for rolling out policies gradually and measuring impact before enforcement.

```bash
SONDERA_DRY_RUN=1 opencode
```

### Allow Patterns

`SONDERA_ALLOW_PATTERNS` is a comma-separated list of regex patterns. When a tool call matches any pattern, it skips adjudication entirely (no harness round-trip). The regex is tested against a combined string of `tool command path url pattern query`.

```bash
# Skip adjudication for git status, ls, and echo
SONDERA_ALLOW_PATTERNS="git status,ls -la,echo" opencode

# Skip all glob and read operations
SONDERA_ALLOW_PATTERNS="\\bglob\\b,\\bread\\b" opencode
```

### Audit Log

Set `SONDERA_AUDIT_LOG` to a file path to record every adjudication as a JSONL entry:

```bash
SONDERA_AUDIT_LOG=/tmp/sondera-audit.jsonl opencode
```

Each line is a JSON object with `ts`, `trajectory_id`, `tool`, `action`, `decision`, `reason`, `dry_run`, and `duration_ms`.

### Session Stats

The plugin logs a summary of adjudication stats when opencode exits (via `console.log`), including total calls, allow/deny/escalate counts, bypasses, errors, and average latency.

## How It Works

```
opencode tool call
       |
       v
  opencode plugin (tool.execute.before)
       |
       v
  sondera-opencode-adapter (Rust binary, persistent stream)
       |
       v
  sondera-harness-server (Unix socket, tarpc)
       |
       v
  Cedar policy engine -> Allow / Deny / Escalate
```

The plugin uses opencode's `tool.execute.before` and `tool.execute.after` hooks:

- **before**: Normalizes the tool event and sends it to the harness. If the harness returns `deny`, the plugin throws a `PolicyDenyError` to block execution.
- **after**: Sends the observation event to the harness for logging/policy evaluation.

The adapter binary supports two modes:

- **stream** (default): a persistent process that reads NDJSON from stdin and writes NDJSON to stdout, reusing the harness connection across calls. The client auto-detects support and falls back to oneshot if unavailable.
- **adjudicate**: one-shot mode for single requests or older binaries. Reads one JSON object from stdin, connects to harness, writes one JSON object to stdout.

## Tool Mapping

| opencode tool | Sondera action |
|---|---|
| `bash` | `ShellCommand` |
| `read` | `FileRead` |
| `edit` | `FileEdit` |
| `write` | `FileWrite` |
| `apply_patch` | `FileEdit` |
| `glob` | `FileSearch` |
| `grep` | `ContentSearch` |
| `webfetch` | `WebFetch` |
| `websearch` | `WebSearch` |
| `task` | `SubAgent` |
| `skill` | `SkillLoad` |
| `todowrite` | `TodoUpdate` |
| `question` | `Question` |
| `lsp` | `LspQuery` |
| (other) | `ToolCall` |

## Resilience

The plugin is designed to **fail open**: if the harness server is down, the adapter
binary is missing, or any error occurs during adjudication, the tool call is allowed
by default. Only an explicit `deny` from the harness blocks execution.

Specifically:
- Adapter binary not found or exits non-zero: allow
- Adapter returns invalid JSON: allow
- Stream process crashes: reconnect on next call
- Old adapter binary without `stream` command: auto-fall back to oneshot
- Harness server not reachable at startup: plugin disables itself (warns once)
- Harness returns an error (e.g., Ollama not running): allow
- Any unhandled exception in the plugin: allow

## Error Types

The plugin throws structured errors that consumers can distinguish:

- `PolicyDenyError`: harness returned `deny`. Has `decision`, `reason`, and `annotations` properties.
- `AdjudicationError`: an unexpected error during adjudication. Logged and allowed (fail-open).
- `HarnessUnavailableError`: harness server could not be reached at startup.

## Tested

End-to-end verified against the Sondera harness server:

```
$ sondera-opencode-adapter health
{"status":"ok"}

$ echo '{"tool":"bash","action":"ShellCommand","trajectory_id":"test","agent_id":"opencode-test","args":{"command":"ls"},"cwd":"/tmp"}' \
  | sondera-opencode-adapter adjudicate
{"decision":"allow","reason":null,"annotations":[]}
```

Release binary: 14MB, tested with harness server running (Cedar + YARA pipeline confirmed).
When Ollama is not running, the harness returns an error and the plugin correctly
defaults to allow.

## License

MIT
