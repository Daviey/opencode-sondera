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

class PolicyDenyError extends Error {
  readonly decision: "deny" = "deny"
  readonly reason: string
  readonly annotations?: AdjudicationResponse["annotations"]

  constructor(response: AdjudicationResponse) {
    const reason = response.reason || "action denied by policy"
    super(`[sondera] ${reason}`)
    this.name = "PolicyDenyError"
    this.reason = reason
    this.annotations = response.annotations
  }
}

class AdjudicationError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super(`[sondera] adjudication failed, allowing by default`)
    this.name = "AdjudicationError"
    this.cause = cause
  }
}

interface SonderaConfig {
  enabled: boolean
  dryRun: boolean
  allowPatterns: RegExp[]
  auditLogPath: string | null
  strictMode: boolean
}

interface ProjectConfig {
  enabled?: boolean
  dryRun?: boolean
  allowPatterns?: string[]
  auditLogPath?: string
  strictMode?: boolean
}

function loadProjectConfig(directory: string): ProjectConfig {
  const candidates = [
    `${directory}/.opencode/sondera.json`,
    `${directory}/sondera.json`,
  ]
  for (const path of candidates) {
    try {
      const { readFileSync } = require("fs")
      const text = readFileSync(path, "utf-8")
      if (text.trim().length > 0) return JSON.parse(text) as ProjectConfig
    } catch {}
  }
  return {}
}

function loadConfig(directory: string): SonderaConfig {
  const project = loadProjectConfig(directory)

  const enabled = process.env.SONDERA_ENABLED !== undefined
    ? process.env.SONDERA_ENABLED !== "false"
    : (project.enabled ?? true)
  const dryRun = process.env.SONDERA_DRY_RUN !== undefined
    ? (process.env.SONDERA_DRY_RUN === "1" || process.env.SONDERA_DRY_RUN === "true")
    : (project.dryRun ?? false)
  const auditLogPath = process.env.SONDERA_AUDIT_LOG ?? project.auditLogPath ?? null
  const strictMode = process.env.SONDERA_STRICT !== undefined
    ? (process.env.SONDERA_STRICT === "1" || process.env.SONDERA_STRICT === "true")
    : (project.strictMode ?? false)

  const allowPatterns: RegExp[] = []
  if (project.allowPatterns) {
    for (const p of project.allowPatterns) {
      try { allowPatterns.push(new RegExp(p)) }
      catch { console.error(`[sondera] invalid allow pattern in config: ${p}`) }
    }
  }

  const raw = process.env.SONDERA_ALLOW_PATTERNS
  if (raw) {
    for (const part of raw.split(",")) {
      const trimmed = part.trim()
      if (trimmed.length === 0) continue
      try { allowPatterns.push(new RegExp(trimmed)) }
      catch { console.error(`[sondera] invalid allow pattern: ${trimmed}`) }
    }
  }

  return { enabled, dryRun, allowPatterns, auditLogPath, strictMode }
}

function matchesAllowPattern(
  tool: string,
  args: Record<string, unknown>,
  patterns: RegExp[],
): boolean {
  if (patterns.length === 0) return false

  const targets = [tool]
  if (typeof args.command === "string") targets.push(args.command)
  if (typeof args.path === "string" || typeof args.filePath === "string") {
    targets.push((args.path as string) || (args.filePath as string) || "")
  }
  if (typeof args.url === "string") targets.push(args.url)
  if (typeof args.pattern === "string") targets.push(args.pattern)
  if (typeof args.query === "string") targets.push(args.query)

  const haystack = targets.join(" ")
  return patterns.some((p) => p.test(haystack))
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

function str(val: unknown): string | undefined {
  if (typeof val === "string" && val.length > 0) return val
  return undefined
}

function toolArgs(
  tool: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (tool) {
    case "bash":
      return {
        command: (args.command as string) || "",
        workdir: str(args.workdir),
      }
    case "read":
      return {
        path: str(args.filePath) || str(args.path) || "",
      }
    case "edit":
      return {
        path: str(args.filePath) || str(args.path) || "",
        old_content: str(args.oldString),
        new_content: str(args.newString),
      }
    case "write":
      return {
        path: str(args.filePath) || str(args.path) || "",
        content: str(args.content),
      }
    case "apply_patch":
      return {
        patch_text: (args.patchText as string) || "",
      }
    case "webfetch":
      return {
        url: (args.url as string) || "",
        format: str(args.format),
      }
    case "glob":
      return {
        pattern: (args.pattern as string) || "",
      }
    case "grep":
      return {
        pattern: (args.pattern as string) || "",
        include: str(args.include),
      }
    case "websearch":
      return {
        query: (args.query as string) || (args.search_query as string) || "",
      }
    default:
      return args
  }
}

class LineReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private decoder = new TextDecoder()
  private buffer = ""

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader()
  }

  async readLine(): Promise<string | null> {
    while (!this.buffer.includes("\n")) {
      const { done, value } = await this.reader.read()
      if (done) {
        const remaining = this.buffer.trim()
        this.buffer = ""
        return remaining.length > 0 ? remaining : null
      }
      this.buffer += this.decoder.decode(value, { stream: true })
    }
    const idx = this.buffer.indexOf("\n")
    const line = this.buffer.slice(0, idx)
    this.buffer = this.buffer.slice(idx + 1)
    return line
  }

  cancel() {
    this.reader.cancel().catch(() => {})
  }
}

class HarnessClient {
  private binaryPath: string
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private lineReader: LineReader | null = null
  private useStream: boolean | null = null
  private chain: Promise<void> = Promise.resolve()

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

  async adjudicate(event: AdapterRequest): Promise<AdjudicationResponse> {
    const token = this.chain
    let release: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    this.chain = gate

    await token
    try {
      return await this._adjudicate(event)
    } finally {
      release!()
    }
  }

  private async _adjudicate(event: AdapterRequest): Promise<AdjudicationResponse> {
    if (this.useStream === false) {
      return this.oneshotAdjudicate(event)
    }

    try {
      await this.ensureStreamProcess()
      const stdin = this.proc!.stdin as unknown as { write: (d: string) => void }
      stdin.write(JSON.stringify(event) + "\n")
      const line = await this.lineReader!.readLine()
      if (line === null) throw new Error("stream closed")
      const result = JSON.parse(line) as AdjudicationResponse
      this.useStream = true
      return result
    } catch (err) {
      this.killStream()
      if (this.useStream === null) {
        this.useStream = false
        return this.oneshotAdjudicate(event)
      }
      console.error(`[sondera] stream error, allowing:`, err)
      return { decision: "allow" }
    }
  }

  private async ensureStreamProcess() {
    if (this.proc && (this.proc as any).exitCode === null) return

    this.proc = Bun.spawn({
      cmd: [this.binaryPath, "stream"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    this.lineReader = new LineReader(this.proc.stdout as ReadableStream<Uint8Array>)

    const capturedProc = this.proc
    capturedProc.exited.then((code) => {
      if (this.proc === capturedProc) {
        if (code !== 0 && this.useStream !== false) {
          console.error(`[sondera] stream process exited with code ${code}`)
        }
        this.proc = null
        this.lineReader = null
      }
    })
  }

  private killStream() {
    if (this.proc) {
      try {
        if (!(this.proc as any).killed) (this.proc as any).kill()
      } catch {}
    }
    if (this.lineReader) {
      this.lineReader.cancel()
    }
    this.proc = null
    this.lineReader = null
  }

  private async oneshotAdjudicate(event: AdapterRequest): Promise<AdjudicationResponse> {
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
      console.error(`[sondera] adapter error (exit ${exitCode}): ${stderr.trim()}`)
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

interface AuditEntry {
  ts: string
  trajectory_id: string
  tool: string
  action: string
  decision: string
  reason?: string
  dry_run: boolean
  duration_ms: number
}

let logWriter: any = null

function initAuditLog(config: SonderaConfig) {
  if (!config.auditLogPath) return
  try {
    const f = Bun.file(config.auditLogPath)
    logWriter = f.writer()
  } catch (err) {
    console.error(`[sondera] failed to open audit log: ${config.auditLogPath}`, err)
  }
}

function writeAudit(
  event: AdapterRequest,
  result: AdjudicationResponse,
  dryRun: boolean,
  durationMs: number,
) {
  if (!logWriter) return
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    trajectory_id: event.trajectory_id,
    tool: event.tool,
    action: event.action,
    decision: result.decision,
    reason: result.reason,
    dry_run: dryRun,
    duration_ms: Math.round(durationMs * 100) / 100,
  }
  try {
    logWriter.write(JSON.stringify(entry) + "\n")
    logWriter.flush()
  } catch {}
}

interface Metrics {
  total: number
  allowed: number
  denied: number
  escalated: number
  dryRunDenies: number
  bypassed: number
  errors: number
  totalDurationMs: number
}

let metrics: Metrics = {
  total: 0, allowed: 0, denied: 0, escalated: 0,
  dryRunDenies: 0, bypassed: 0, errors: 0, totalDurationMs: 0,
}

function recordAllow(d: number) { metrics.total++; metrics.allowed++; metrics.totalDurationMs += d }
function recordDeny(d: number) { metrics.total++; metrics.denied++; metrics.totalDurationMs += d }
function recordEscalate(d: number) { metrics.total++; metrics.escalated++; metrics.totalDurationMs += d }
function recordDryRunDeny(d: number) { metrics.total++; metrics.dryRunDenies++; metrics.totalDurationMs += d }
function recordBypass() { metrics.total++; metrics.bypassed++ }
function recordError() { metrics.total++; metrics.errors++ }

function logSummary() {
  if (metrics.total === 0) return
  const avg = Math.round((metrics.totalDurationMs / metrics.total) * 100) / 100
  console.log(
    `[sondera] session stats: ${metrics.total} calls, ` +
    `${metrics.allowed} allowed, ${metrics.denied} denied, ` +
    `${metrics.escalated} escalated, ${metrics.dryRunDenies} dry-run denies, ` +
    `${metrics.bypassed} bypassed, ${metrics.errors} errors, avg ${avg}ms`,
  )
}

let client: HarnessClient | null = null
let initialized = false
let config: SonderaConfig | null = null

async function getClient(): Promise<HarnessClient | null> {
  if (initialized) return client
  initialized = true

  if (!config!.enabled) {
    return null
  }

  const c = new HarnessClient()
  const healthy = await c.health()
  if (!healthy) {
    if (config!.strictMode) {
      console.error(
        "[sondera] strict mode: harness server not available — blocking all tool calls",
      )
    } else {
      console.warn(
        "[sondera] harness server not available — policy enforcement disabled",
      )
    }
    return null
  }

  initAuditLog(config!)
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
        if (config!.strictMode) {
          throw new Error("[sondera] strict mode: adjudication failed, blocking by default")
        }
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
