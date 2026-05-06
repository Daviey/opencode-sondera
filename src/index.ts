import type { PluginContext } from "./types"
import { HarnessClient } from "./client"
import { normalizeEvent, toolArgs } from "./normalize"

let client: HarnessClient | null = null
let initialized = false

export function _reset() {
  client = null
  initialized = false
}

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

export const SonderaPlugin = async ({
  directory,
}: PluginContext) => {
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

export { HarnessClient } from "./client"
export { normalizeEvent, toolArgs } from "./normalize"
