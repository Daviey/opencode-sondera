export interface ToolInput {
  tool: string
  sessionId?: string
}

export interface ToolOutput {
  args: Record<string, unknown>
  result?: unknown
}

export interface AdapterRequest {
  trajectory_id: string
  agent_id: string
  tool: string
  action: string
  args: Record<string, unknown>
  cwd?: string
  event_type: "before" | "after"
}

export interface AdjudicationResponse {
  decision: "allow" | "deny" | "escalate"
  reason?: string
  annotations?: Array<{
    policy_id?: string
    description?: string
    annotations?: Record<string, string>
  }>
}

export interface PluginContext {
  project: { path: string }
  client: unknown
  $: unknown
  directory: string
  worktree: string
}
