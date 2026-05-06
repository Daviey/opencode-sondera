import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { PolicyDenyError } from "./types"

const origSpawn = Bun.spawn

beforeEach(() => {
  delete process.env.SONDERA_ENABLED
  delete process.env.SONDERA_ADAPTER_PATH
})

afterEach(() => {
  Bun.spawn = origSpawn as any
})

function makeStdout(text: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    },
  })
}

function mockSpawnOnce(exitCode: number, stdout: string) {
  Bun.spawn = mock(() => ({
    stdin: { write: mock(() => {}), end: mock(() => {}) },
    stdout: makeStdout(stdout),
    stderr: makeStdout(""),
    exited: Promise.resolve(exitCode),
  })) as any
}

function mockSpawnHealthyThenRespond(healthExit: number, adjExit: number, adjStdout: string) {
  let callCount = 0
  Bun.spawn = mock(() => {
    callCount++
    if (callCount === 1) {
      return {
        stdin: { write: mock(() => {}), end: mock(() => {}) },
        stdout: makeStdout(""),
        stderr: makeStdout(""),
        exited: Promise.resolve(healthExit),
      }
    }
    return {
      stdin: { write: mock(() => {}), end: mock(() => {}) },
      stdout: makeStdout(adjStdout),
      stderr: makeStdout(""),
      exited: Promise.resolve(adjExit),
    }
  }) as any
}

async function makePlugin() {
  const mod = await import("./index")
  mod._reset()
  return mod.SonderaPlugin({
    directory: "/tmp",
    project: { path: "/tmp" },
    client: {} as any,
    $: {} as any,
    worktree: "/tmp",
  })
}

describe("SonderaPlugin", () => {
  it("blocks execution on deny", async () => {
    mockSpawnHealthyThenRespond(0, 0, JSON.stringify({ decision: "deny", reason: "forbidden" }))

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "rm -rf /" } }

    try {
      await plugin["tool.execute.before"](input, output)
      expect.unreachable("should have thrown")
    } catch (err: any) {
      expect(err).toBeInstanceOf(PolicyDenyError)
      expect(err.reason).toBe("forbidden")
      expect(err.decision).toBe("deny")
    }
  })

  it("blocks execution with policy annotations on deny", async () => {
    const response = {
      decision: "deny",
      reason: "policy violation",
      annotations: [
        { policy_id: "P001", description: "No destructive commands" },
      ],
    }
    mockSpawnHealthyThenRespond(0, 0, JSON.stringify(response))

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "rm -rf /" } }

    try {
      await plugin["tool.execute.before"](input, output)
      expect.unreachable("should have thrown")
    } catch (err: any) {
      expect(err).toBeInstanceOf(PolicyDenyError)
      expect(err.reason).toBe("policy violation")
      expect(err.annotations).toHaveLength(1)
      expect(err.annotations![0].policy_id).toBe("P001")
    }
  })

  it("allows execution on allow", async () => {
    mockSpawnHealthyThenRespond(0, 0, JSON.stringify({ decision: "allow" }))

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.before"](input, output)
  })

  it("allows execution on escalate (logs warning)", async () => {
    mockSpawnHealthyThenRespond(0, 0, JSON.stringify({ decision: "escalate", reason: "suspicious" }))

    const warnSpy = mock(() => {})
    const origWarn = console.warn
    console.warn = warnSpy

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.before"](input, output)
    expect(warnSpy).toHaveBeenCalled()

    console.warn = origWarn
  })

  it("allows execution when adapter exits non-zero (fail open)", async () => {
    mockSpawnHealthyThenRespond(0, 1, "")

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.before"](input, output)
  })

  it("allows execution when spawn throws (fail open)", async () => {
    let callCount = 0
    Bun.spawn = mock(() => {
      callCount++
      if (callCount === 1) {
        return {
          stdin: { write: mock(() => {}), end: mock(() => {}) },
          stdout: makeStdout(""),
          stderr: makeStdout(""),
          exited: Promise.resolve(0),
        }
      }
      throw new Error("ENOENT: adapter not found")
    }) as any

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.before"](input, output)
  })

  it("after hook does not throw on deny", async () => {
    mockSpawnHealthyThenRespond(0, 0, JSON.stringify({ decision: "deny" }))

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.after"](input, output)
  })

  it("after hook does not throw on spawn failure", async () => {
    let callCount = 0
    Bun.spawn = mock(() => {
      callCount++
      if (callCount === 1) {
        return {
          stdin: { write: mock(() => {}), end: mock(() => {}) },
          stdout: makeStdout(""),
          stderr: makeStdout(""),
          exited: Promise.resolve(0),
        }
      }
      throw new Error("spawn failed")
    }) as any

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.after"](input, output)
  })

  it("disables when SONDERA_ENABLED=false", async () => {
    process.env.SONDERA_ENABLED = "false"

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.before"](input, output)
    await plugin["tool.execute.after"](input, output)
  })

  it("disables when health check fails", async () => {
    Bun.spawn = mock(() => ({
      stdin: { write: mock(() => {}), end: mock(() => {}) },
      stdout: makeStdout(""),
      stderr: makeStdout(""),
      exited: Promise.resolve(1),
    })) as any

    const plugin = await makePlugin()

    const input = { tool: "bash", sessionId: "s1" }
    const output = { args: { command: "ls" } }

    await plugin["tool.execute.before"](input, output)
    await plugin["tool.execute.after"](input, output)
  })
})
