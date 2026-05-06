import type { PluginContext } from "./types"
import { HarnessClient } from "./client"
import { normalizeEvent, toolArgs } from "./normalize"
import { PolicyDenyError, AdjudicationError } from "./types"
import { loadConfig, matchesAllowPattern } from "./config"
import { initAuditLog, writeAudit, closeAuditLog } from "./audit"
import {
  recordAllow, recordDeny, recordEscalate,
  recordDryRunDeny, recordBypass, recordError, logSummary,
  resetMetrics,
} from "./metrics"

let client: HarnessClient | null = null
let initialized = false
let config: ReturnType<typeof loadConfig> | null = null

export function _reset() {
  client = null
  initialized = false
  config = null
  resetMetrics()
  closeAuditLog()
}

async function getClient(): Promise<HarnessClient | null> {
  if (initialized) return client
  initialized = true

  if (!config!.enabled) {
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

  initAuditLog(config!)
  client = c
  return client
}

const SONDERA_AGENT_ID = `opencode-${process.env.USER || "unknown"}`

export const SonderaPlugin = async ({
  directory,
}: PluginContext) => {
  config = loadConfig(directory)

  return {
    "tool.execute.before": async (input: any, output: any) => {
      const c = await getClient()
      if (!c) return

      const args = toolArgs(input.tool, output.args)

      if (matchesAllowPattern(input.tool, args, config!.allowPatterns)) {
        recordBypass()
        return
      }

      const event = normalizeEvent(
        input.tool,
        args,
        directory,
        input.sessionId,
        SONDERA_AGENT_ID,
        "before",
      )

      const start = performance.now()
      let result
      try {
        result = await c.adjudicate(event)
      } catch (err) {
        console.error(new AdjudicationError(err))
        recordError()
        return
      }
      const durationMs = performance.now() - start

      writeAudit(event, result, config!.dryRun, durationMs)

      if (result.decision === "deny") {
        if (config!.dryRun) {
          const reason = result.reason || "action denied by policy"
          console.warn(`[sondera] dry-run deny (would block): ${reason}`)
          recordDryRunDeny(durationMs)
          return
        }
        recordDeny(durationMs)
        throw new PolicyDenyError(result)
      }

      if (result.decision === "allow") {
        recordAllow(durationMs)
      }

      if (result.decision === "escalate") {
        recordEscalate(durationMs)
        const reason = result.reason || "action requires approval"
        const policyCtx = formatPolicyContext(result)
        const msg = policyCtx ? `${reason}\n${policyCtx}` : reason
        console.warn(`[sondera] escalation: ${msg}`)
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
        console.error(new AdjudicationError(err))
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
export { PolicyDenyError, HarnessUnavailableError, AdjudicationError } from "./types"
export { loadConfig, matchesAllowPattern } from "./config"
export { getMetrics, resetMetrics, logSummary } from "./metrics"
export { writeAudit, closeAuditLog } from "./audit"
