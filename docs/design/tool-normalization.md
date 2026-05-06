# Tool Normalization

opencode tools are mapped to Sondera action types with tool-specific argument extraction.

## Action Map

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
| `websearch` | `WebSearch` | `query` (from `query` or `search_query`) |
| `task` | `SubAgent` | (raw args) |
| `skill` | `SkillLoad` | (raw args) |
| `todowrite` | `TodoUpdate` | (raw args) |
| `question` | `Question` | (raw args) |
| `lsp` | `LspQuery` | (raw args) |
| (any other) | `ToolCall` | (raw args passed through) |

## Extraction logic

Each tool has a case in the `toolArgs()` function that picks specific fields from the raw args and discards the rest. Unknown tools get their args passed through unmodified.

The `normalizeEvent()` function wraps the extracted args into an `AdapterRequest` with a trajectory ID (from `sessionID` or `sessionId`), agent ID, tool name, action type, working directory, and event type (`before` or `after`).

## Allow pattern matching

Before normalization, `matchesAllowPattern()` checks the raw tool name and extracted args against configured regex patterns. A space-joined string of `tool command path url pattern query` is tested. Matched calls skip the harness entirely.
