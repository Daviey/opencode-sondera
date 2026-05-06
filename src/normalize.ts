import type { AdapterRequest } from "./types"

const TOOL_ACTION_MAP: Record<string, string> = {
  bash: "ShellCommand",
  read: "FileRead",
  edit: "FileEdit",
  write: "FileWrite",
  apply_patch: "FileEdit",
  glob: "FileSearch",
  grep: "ContentSearch",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  question: "Question",
  task: "SubAgent",
  skill: "SkillLoad",
  todowrite: "TodoUpdate",
  lsp: "LspQuery",
}

export function normalizeEvent(
  tool: string,
  args: Record<string, unknown>,
  cwd: string | undefined,
  sessionId: string | undefined,
  agentId: string,
  eventType: "before" | "after",
): AdapterRequest {
  return {
    trajectory_id: sessionId || "unknown",
    agent_id: agentId,
    tool,
    action: TOOL_ACTION_MAP[tool] || "ToolCall",
    args,
    cwd,
    event_type: eventType,
  }
}

export function toolArgs(
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (tool) {
    case "bash":
      return {
        command: (args.command as string) || "",
        workdir: args.workdir || undefined,
      }
    case "read":
      return {
        path: args.filePath || args.path || "",
      }
    case "edit":
      return {
        path: args.filePath || args.path || "",
        old_content: args.oldString || undefined,
        new_content: args.newString || undefined,
      }
    case "write":
      return {
        path: args.filePath || args.path || "",
        content: args.content || undefined,
      }
    case "apply_patch":
      return {
        patch_text: args.patchText || "",
      }
    case "webfetch":
      return {
        url: args.url || "",
        format: args.format || undefined,
      }
    case "glob":
      return {
        pattern: args.pattern || "",
      }
    case "grep":
      return {
        pattern: args.pattern || "",
        include: args.include || undefined,
      }
    default:
      return args
  }
}
