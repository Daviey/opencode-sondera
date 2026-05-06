# ADR-015: TUI Toast Notifications

Date: 2026-05

## Context

The plugin used `console.log`, `console.warn`, and `console.error` to surface policy events. These messages go to opencode's debug log, not the terminal UI. Users had no visible feedback when the harness denied a tool call or the server was unreachable. Events were invisible unless the user opened debug logs.

opencode exposes a TUI toast endpoint at `POST /tui/show-toast` on its local server. This renders transient notifications in the terminal UI with configurable severity, title, message, and duration.

## Decision

Add `src/toast.ts` that sends toast notifications via `fetch` to the opencode server origin. The plugin receives `serverUrl` from the `PluginContext` at initialization and uses it for all toast calls.

Toast notifications are sent for these events:
- Harness unreachable at startup (warning or error depending on strict mode)
- Policy deny with reason (error)
- Policy escalation with reason and policy context (warning)
- Dry-run deny (warning, prefixed "dry-run")
- Adjudication failure in strict mode (error)

`console.error` is retained for non-user-facing errors (adjudication exceptions, adapter errors). Toasts complement these with user-visible messages.

## Consequences

If `serverUrl` is not provided (older opencode versions, test environments), toasts silently do nothing. The `sendToast` function catches all fetch errors. No fallback to `console.log` for user-facing messages; those channels remain separate.

The toast endpoint is a TUI concern. The plugin is a server plugin and accesses it via HTTP, which avoids needing a separate TUI plugin module.
