import { describe, expect, it, beforeEach } from "bun:test"
import { loadConfig, matchesAllowPattern } from "./config"

describe("loadConfig", () => {
  beforeEach(() => {
    delete process.env.SONDERA_ENABLED
    delete process.env.SONDERA_DRY_RUN
    delete process.env.SONDERA_ALLOW_PATTERNS
    delete process.env.SONDERA_AUDIT_LOG
  })

  it("returns defaults", () => {
    const config = loadConfig("/tmp")
    expect(config.enabled).toBe(true)
    expect(config.dryRun).toBe(false)
    expect(config.allowPatterns).toEqual([])
    expect(config.auditLogPath).toBeNull()
  })

  it("respects SONDERA_ENABLED=false", () => {
    process.env.SONDERA_ENABLED = "false"
    const config = loadConfig("/tmp")
    expect(config.enabled).toBe(false)
  })

  it("enables dry run with SONDERA_DRY_RUN=1", () => {
    process.env.SONDERA_DRY_RUN = "1"
    const config = loadConfig("/tmp")
    expect(config.dryRun).toBe(true)
  })

  it("enables dry run with SONDERA_DRY_RUN=true", () => {
    process.env.SONDERA_DRY_RUN = "true"
    const config = loadConfig("/tmp")
    expect(config.dryRun).toBe(true)
  })

  it("parses allow patterns", () => {
    process.env.SONDERA_ALLOW_PATTERNS = "git status,ls .*,echo"
    const config = loadConfig("/tmp")
    expect(config.allowPatterns).toHaveLength(3)
    expect(config.allowPatterns[0].source).toBe("git status")
    expect(config.allowPatterns[1].source).toBe("ls .*")
  })

  it("skips invalid allow patterns", () => {
    process.env.SONDERA_ALLOW_PATTERNS = "valid,([invalid,also-valid"
    const config = loadConfig("/tmp")
    expect(config.allowPatterns).toHaveLength(2)
  })

  it("sets audit log path", () => {
    process.env.SONDERA_AUDIT_LOG = "/tmp/sondera-audit.jsonl"
    const config = loadConfig("/tmp")
    expect(config.auditLogPath).toBe("/tmp/sondera-audit.jsonl")
  })

  it("handles empty allow patterns", () => {
    process.env.SONDERA_ALLOW_PATTERNS = ""
    const config = loadConfig("/tmp")
    expect(config.allowPatterns).toEqual([])
  })

  it("handles comma-only allow patterns", () => {
    process.env.SONDERA_ALLOW_PATTERNS = ",,,"
    const config = loadConfig("/tmp")
    expect(config.allowPatterns).toEqual([])
  })
})

describe("matchesAllowPattern", () => {
  it("returns false with no patterns", () => {
    expect(matchesAllowPattern("bash", { command: "ls" }, [])).toBe(false)
  })

  it("matches bash command", () => {
    const patterns = [/\bgit status\b/]
    expect(matchesAllowPattern("bash", { command: "git status" }, patterns)).toBe(true)
    expect(matchesAllowPattern("bash", { command: "git push" }, patterns)).toBe(false)
  })

  it("matches tool name", () => {
    const patterns = [/\bglob\b/]
    expect(matchesAllowPattern("glob", { pattern: "**/*.ts" }, patterns)).toBe(true)
    expect(matchesAllowPattern("grep", { pattern: "TODO" }, patterns)).toBe(false)
  })

  it("matches url", () => {
    const patterns = [/https:\/\/docs\.example\.com/]
    expect(matchesAllowPattern("webfetch", { url: "https://docs.example.com/api" }, patterns)).toBe(true)
    expect(matchesAllowPattern("webfetch", { url: "https://evil.com" }, patterns)).toBe(false)
  })

  it("matches path", () => {
    const patterns = [/\/home\/user\/safe/]
    expect(matchesAllowPattern("read", { path: "/home/user/safe/file.ts" }, patterns)).toBe(true)
    expect(matchesAllowPattern("read", { path: "/etc/passwd" }, patterns)).toBe(false)
  })

  it("matches any field in the combined haystack", () => {
    const patterns = [/TODO/]
    expect(matchesAllowPattern("grep", { pattern: "TODO" }, patterns)).toBe(true)
    expect(matchesAllowPattern("grep", { pattern: "FIXME" }, patterns)).toBe(false)
  })
})
