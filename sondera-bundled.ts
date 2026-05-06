interface AdapterRequest {
  trajectory_id: string
  agent_id: string
  tool: string
  action: string
  args: Record<string, unknown>
  cwd?: string
  event_type: "before" | "after"
}

interface AdjudicationResponse {
  decision: "allow" | "deny" | "escalate"
  reason?: string
  annotations?: Array<{
    policy_id?: string
    description?: string
    annotations?: Record<string, string>
  }>
}

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

function normalizeEvent(
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

function toolArgs(
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

class HarnessClient {
  private binaryPath: string

  constructor(binaryPath?: string) {
    const envPath = process.env.SONDERA_ADAPTER_PATH
    if (envPath) {
      this.binaryPath = envPath
    } else if (binaryPath) {
      this.binaryPath = binaryPath
    } else {
      const home = process.env.HOME || "/root"
      this.binaryPath = `${home}/.local/bin/sondera-opencode-adapter`
    }
  }

  async adjudicate(
    event: AdapterRequest,
  ): Promise<AdjudicationResponse> {
    const proc = Bun.spawn({
      cmd: [this.binaryPath, "adjudicate"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    proc.stdin.write(JSON.stringify(event))
    proc.stdin.end()

    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      console.error(
        `[sondera] adapter error (exit ${exitCode}): ${stderr.trim()}`,
      )
      return { decision: "allow" }
    }

    const stdout = await new Response(proc.stdout).text()
    try {
      return JSON.parse(stdout.trim()) as AdjudicationResponse
    } catch {
      console.error(`[sondera] invalid adapter response: ${stdout.trim()}`)
      return { decision: "allow" }
    }
  }

  async health(): Promise<boolean> {
    try {
      const proc = Bun.spawn({
        cmd: [this.binaryPath, "health"],
        stdout: "pipe",
        stderr: "pipe",
      })
      const exitCode = await proc.exited
      return exitCode === 0
    } catch {
      return false
    }
  }
}

let client: HarnessClient | null = null
let initialized = false

async function getClient(): Promise<HarnessClient | null> {
  if (initialized) return client
  initialized = true

  if (process.env.SONDERA_ENABLED === "false") {
    return null
  }

  const c = new HarnessClient()
  const healthy = await c.health()
  if (!healthy) {
    console.warn(
      "[sondera] harness server not available — policy enforcement disabled",
    )
    return null
  }

  client = c
  return client
}

const SONDERA_AGENT_ID = `opencode-${process.env.USER || "unknown"}`

function formatPolicyContext(result: {
  annotations?: Array<{
    policy_id?: string
    description?: string
    annotations?: Record<string, string>
  }>
}): string | null {
  if (!result.annotations || result.annotations.length === 0) return null

  const parts = result.annotations
    .map((a) => {
      const lines: string[] = []
      if (a.policy_id && a.description) {
        lines.push(`[Policy: ${a.policy_id}] ${a.description}`)
      } else if (a.policy_id) {
        lines.push(`[Policy: ${a.policy_id}]`)
      } else if (a.description) {
        lines.push(a.description)
      }
      if (a.annotations) {
        for (const [key, value] of Object.entries(a.annotations)) {
          lines.push(`  ${key}: ${value}`)
        }
      }
      return lines.join("\n")
    })
    .filter((s) => s.length > 0)

  return parts.length > 0 ? parts.join("\n") : null
}

export const SonderaPlugin = async ({
  directory,
}: {
  project: { path: string }
  client: unknown
  $: unknown
  directory: string
  worktree: string
}) => {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      const c = await getClient()
      if (!c) return

      const args = toolArgs(input.tool, output.args)
      const event = normalizeEvent(
        input.tool,
        args,
        directory,
        input.sessionId,
        SONDERA_AGENT_ID,
        "before",
      )

      let result
      try {
        result = await c.adjudicate(event)
      } catch (err) {
        console.error(`[sondera] adjudication failed, allowing by default:`, err)
        return
      }

      if (result.decision === "deny") {
        const reason = result.reason || "action denied by policy"
        const policyCtx = formatPolicyContext(result)
        const msg = policyCtx ? `${reason}\n\n${policyCtx}` : reason
        throw new Error(`[sondera] ${msg}`)
      }

      if (result.decision === "escalate") {
        const reason = result.reason || "action requires approval"
        console.warn(`[sondera] escalation: ${reason}`)
      }
    },

    "tool.execute.after": async (input: any, output: any) => {
      const c = await getClient()
      if (!c) return

      const args = toolArgs(input.tool, output.args)
      const event = normalizeEvent(
        input.tool,
        args,
        directory,
        input.sessionId,
        SONDERA_AGENT_ID,
        "after",
      )

      try {
        await c.adjudicate(event)
      } catch (err) {
        console.error(`[sondera] after-hook adjudication failed:`, err)
      }
    },
  }
}
