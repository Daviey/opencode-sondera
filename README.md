# opencode-sondera

[![CI](https://github.com/Daviey/opencode-sondera/actions/workflows/ci.yml/badge.svg)](https://github.com/Daviey/opencode-sondera/actions/workflows/ci.yml)
[![Security](https://github.com/Daviey/opencode-sondera/actions/workflows/security.yml/badge.svg)](https://github.com/Daviey/opencode-sondera/actions/workflows/security.yml)
[![codecov](https://codecov.io/github/Daviey/opencode-sondera/graph/badge.svg?token=NS2GU7WBS3)](https://codecov.io/github/Daviey/opencode-sondera)
[![Release](https://github.com/Daviey/opencode-sondera/actions/workflows/publish.yml/badge.svg)](https://github.com/Daviey/opencode-sondera/actions/workflows/publish.yml)
[![npm](https://img.shields.io/npm/v/opencode-sondera)](https://www.npmjs.com/package/opencode-sondera)
[![GitHub Release](https://img.shields.io/github/v/release/Daviey/opencode-sondera)](https://github.com/Daviey/opencode-sondera/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Daviey/opencode-sondera/badge)](https://scorecard.dev/viewer/?uri=github.com/Daviey/opencode-sondera)

A policy enforcement plugin for [opencode](https://opencode.ai) that screens every tool call against rules you define.

## Why

AI coding agents can run any shell command, read any file, and fetch any URL. Most of the time that is fine. Sometimes it is not. A typo in a prompt can produce `rm -rf /` instead of `rm -rf ./build`. An agent working on a public repo might follow a link to an internal service. A compromised dependency could instruct the model to exfiltrate environment variables.

opencode-sondera sits between opencode and the tools it calls. Every tool invocation (shell commands, file reads and writes, web fetches, searches) is checked against a policy before it runs. Denied calls are blocked. Suspicious calls are logged. Allowed calls proceed without intervention.

Policies are written in [Cedar](https://www.cedarpolicy.com/), Amazon's open source policy language. Cedar policies are declarative, readable, and auditable. A sample policy that blocks destructive shell commands:

```cedar
permit(
  principal,
  action == Action::"ShellCommand",
  resource
)
when { !resource.command.contains("rm -rf") };
```

The [Sondera harness server](https://github.com/sondera-ai/sondera-coding-agent-hooks) evaluates these policies. It bundles a Cedar engine with optional YARA rule scanning and LLM-based classification for commands that fall into grey areas. The harness runs as a local process; no data leaves your machine unless you configure an external classifier.

This plugin is the glue between opencode and the harness. It normalises tool calls into a common format, sends them for adjudication, and enforces the decision.

## Prerequisites

- [opencode](https://opencode.ai) with plugin support
- [Sondera harness server](https://github.com/sondera-ai/sondera-coding-agent-hooks) (can be auto-started, see below)

## Install

### Quick install (curl)

```bash
curl -fsSL https://github.com/Daviey/opencode-sondera/raw/main/install.sh | bash
```

This downloads the latest adapter binary and plugin for your platform, validates them, and installs to `~/.local/bin/` and `~/.config/opencode/plugins/`. opencode auto-loads `.ts` files from the plugins directory.

### npm

```bash
npm install opencode-sondera
```

Then reference it in your opencode config:

```json
// opencode.json
{
  "plugin": ["opencode-sondera"]
}
```

### Build the adapter from source

You need this if you want to hack on the adapter or your platform has no pre-built binary.

**Using nix-shell:**

```bash
cd ..
git clone https://github.com/sondera-ai/sondera-coding-agent-hooks.git
```

> **Note:** The `--deterministic-only` flag is required for fast startup without Ollama. Until [upstream issue #8](https://github.com/sondera-ai/sondera-coding-agent-hooks/issues/8) is merged, use the [fork branch](https://github.com/Daviey/sondera-coding-agent-hooks/tree/feat/deterministic-only) instead:
> ```bash
> git clone -b feat/deterministic-only https://github.com/Daviey/sondera-coding-agent-hooks.git
> ```

```bash
cp -r opencode/sondera/adapter sondera-coding-agent-hooks/apps/opencode
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

### Start the harness server

You can start the harness manually, or let the plugin auto-start it on first tool call.

**Manual start:**

```bash
cd ../sondera-coding-agent-hooks
./target/debug/sondera-harness-server --deterministic-only -v
```

**Auto-start (recommended):**

Add `harnessPath` and `policiesPath` to your project config (`.opencode/sondera.json`):

```json
{
  "harnessPath": "/path/to/sondera-harness-server",
  "policiesPath": "/path/to/sondera-coding-agent-hooks/policies"
}
```

The plugin checks if the harness is already running. If not, it spawns the server process and waits up to 5 seconds for it to become healthy. If the harness was already running, spawning is skipped.

Environment variable alternatives: `SONDERA_HARNESS_PATH` and `SONDERA_POLICIES_PATH`.

### Verify the connection

```bash
sondera-opencode-adapter health
# {"status":"ok"}
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
| `SONDERA_HARNESS_PATH` | (none) | Path to the harness server binary. When set, the plugin auto-starts the harness if it is not already running. |
| `SONDERA_POLICIES_PATH` | (none) | Path to Cedar policy directory, passed to the harness server via `--policy-path` |
| `SONDERA_ENABLED` | `true` | Set to `false` to disable |
| `SONDERA_DRY_RUN` | `false` | Set to `1` or `true` to log denials without blocking |
| `SONDERA_STRICT` | `false` | Set to `1` or `true` to fail-closed on errors and harness unavailability |
| `SONDERA_ALLOW_PATTERNS` | (none) | Comma-separated regex patterns to bypass adjudication |
| `SONDERA_AUDIT_LOG` | (none) | Path to JSONL file for adjudication audit trail |
| `SONDERA_ADJUDICATE_TIMEOUT_MS` | `5000` | Milliseconds before adjudication is aborted (fail-open) |
| `SONDERA_DETERMINISTIC_ONLY` | `true` | Set to `false` to enable LLM classifiers (requires Ollama) |

### Strict Mode

Set `SONDERA_STRICT=1` to fail-closed instead of fail-open. When strict mode is active:

- Harness server unreachable at startup: all tool calls blocked
- Adjudication fails (adapter crash, invalid response, network error): tool call blocked
- Policy deny: tool call blocked (same as normal mode)

This trades availability for security. Use it in environments where policy enforcement is mandatory (CI pipelines, shared workstations, production-adjacent development).

```bash
SONDERA_STRICT=1 opencode
```

### Per-Project Configuration

Create `.opencode/sondera.json` or `sondera.json` in your project root:

```json
{
  "enabled": true,
  "dryRun": false,
  "strictMode": false,
  "harnessPath": "/path/to/sondera-harness-server",
  "policiesPath": "/path/to/sondera-coding-agent-hooks/policies",
  "allowPatterns": ["git status", "git diff", "git log"],
  "auditLogPath": "/tmp/sondera-audit.jsonl",
  "adjudicateTimeoutMs": 5000,
  "deterministicOnly": true
}
```

Environment variables override project config. If `SONDERA_STRICT` is set, the project config's `strictMode` is ignored.

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

The plugin logs a summary of adjudication stats when opencode exits, including total calls, allow/deny/escalate counts, bypasses, errors, and average latency. Output goes to stderr to avoid interfering with the TUI.

## Custom Policies

The harness server loads Cedar policies from a directory at startup (via `--policy-path`). To use custom policies per project, run a separate harness server instance with a different policy directory and socket path:

```bash
# Start a per-project harness with custom policies
sondera-harness-server --deterministic-only --policy-path ./my-policies/ --socket /tmp/sondera-project.sock

# Point the adapter at the custom socket
SONDERA_SOCKET=/tmp/sondera-project.sock opencode
```

Per-request policy overlays are not supported by the current harness API. The policy set is fixed for the lifetime of the server process.

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

The plugin is designed to **fail open** by default: if the harness server is down, the adapter
binary is missing, or any error occurs during adjudication, the tool call is allowed
by default. Only an explicit `deny` from the harness blocks execution.

Set `SONDERA_STRICT=1` to reverse this behavior and block tool calls on any failure.

Specifically (default/fail-open mode):
- Adapter binary not found or exits non-zero: allow
- Adapter returns invalid JSON: allow
- Stream process crashes: reconnect on next call
- Old adapter binary without `stream` command: auto-fall back to oneshot
- Harness server not reachable and auto-start not configured: plugin disables itself (warns once)
- Harness server not reachable and auto-start configured: plugin spawns the server, waits, then retries
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

Apache-2.0
