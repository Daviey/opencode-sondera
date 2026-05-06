export interface SonderaConfig {
  enabled: boolean
  dryRun: boolean
  allowPatterns: RegExp[]
  auditLogPath: string | null
}

export function loadConfig(directory: string): SonderaConfig {
  const enabled = process.env.SONDERA_ENABLED !== "false"
  const dryRun = process.env.SONDERA_DRY_RUN === "1" || process.env.SONDERA_DRY_RUN === "true"
  const allowPatterns = loadAllowPatterns()
  const auditLogPath = process.env.SONDERA_AUDIT_LOG || null

  return { enabled, dryRun, allowPatterns, auditLogPath }
}

function loadAllowPatterns(): RegExp[] {
  const raw = process.env.SONDERA_ALLOW_PATTERNS
  if (!raw) return []

  const patterns: RegExp[] = []
  for (const part of raw.split(",")) {
    const trimmed = part.trim()
    if (trimmed.length === 0) continue
    try {
      patterns.push(new RegExp(trimmed))
    } catch {
      console.error(`[sondera] invalid allow pattern: ${trimmed}`)
    }
  }
  return patterns
}

export function matchesAllowPattern(
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
