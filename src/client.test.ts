import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { HarnessClient } from "./client"

const origSpawn = Bun.spawn

beforeEach(() => {
  Bun.spawn = origSpawn as any
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

function makeMockSpawn(exitCode: number, stdout: string, stderr: string = "") {
  return mock(() => ({
    stdin: {
      write: mock(() => {}),
      end: mock(() => {}),
    },
    stdout: makeStdout(stdout),
    stderr: makeStdout(stderr),
    exited: Promise.resolve(exitCode),
  }))
}

describe("HarnessClient", () => {
  describe("constructor", () => {
    it("uses provided binaryPath", () => {
      const c = new HarnessClient("/usr/local/bin/adapter")
      expect((c as any).binaryPath).toBe("/usr/local/bin/adapter")
    })

    it("falls back to SONDERA_ADAPTER_PATH env", () => {
      process.env.SONDERA_ADAPTER_PATH = "/custom/adapter"
      const c = new HarnessClient()
      expect((c as any).binaryPath).toBe("/custom/adapter")
      delete process.env.SONDERA_ADAPTER_PATH
    })

    it("falls back to default path under HOME", () => {
      delete process.env.SONDERA_ADAPTER_PATH
      const c = new HarnessClient()
      const home = process.env.HOME || "/root"
      expect((c as any).binaryPath).toBe(`${home}/.local/bin/sondera-opencode-adapter`)
    })
  })

  describe("adjudicate", () => {
    it("returns allow on successful allow response", async () => {
      const mockSpawn = makeMockSpawn(0, JSON.stringify({ decision: "allow" }))
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/bin/adapter")
      const result = await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: { command: "ls" },
        event_type: "before",
      })

      expect(result.decision).toBe("allow")
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it("returns deny when harness denies", async () => {
      const response = { decision: "deny", reason: "blocked" }
      const mockSpawn = makeMockSpawn(0, JSON.stringify(response))
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/bin/adapter")
      const result = await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: { command: "rm -rf /" },
        event_type: "before",
      })

      expect(result.decision).toBe("deny")
      expect(result.reason).toBe("blocked")
    })

    it("returns allow when adapter exits non-zero (fail open)", async () => {
      const mockSpawn = makeMockSpawn(1, "", "Error: connection refused")
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/bin/adapter")
      const result = await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: {},
        event_type: "before",
      })

      expect(result.decision).toBe("allow")
    })

    it("returns allow when adapter returns invalid JSON (fail open)", async () => {
      const mockSpawn = makeMockSpawn(0, "not json at all")
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/bin/adapter")
      const result = await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: {},
        event_type: "before",
      })

      expect(result.decision).toBe("allow")
    })

    it("returns escalate with reason", async () => {
      const response = { decision: "escalate", reason: "sensitive operation" }
      const mockSpawn = makeMockSpawn(0, JSON.stringify(response))
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/bin/adapter")
      const result = await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "write",
        action: "FileWrite",
        args: { path: "/etc/passwd" },
        event_type: "before",
      })

      expect(result.decision).toBe("escalate")
      expect(result.reason).toBe("sensitive operation")
    })

    it("returns response with annotations", async () => {
      const response = {
        decision: "deny",
        reason: "policy violation",
        annotations: [
          { policy_id: "P001", description: "No shell access" },
        ],
      }
      const mockSpawn = makeMockSpawn(0, JSON.stringify(response))
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/bin/adapter")
      const result = await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: {},
        event_type: "before",
      })

      expect(result.decision).toBe("deny")
      expect(result.annotations).toHaveLength(1)
      expect(result.annotations![0].policy_id).toBe("P001")
    })

    it("writes JSON to stdin and ends it", async () => {
      const stdinWrite = mock(() => {})
      const stdinEnd = mock(() => {})
      Bun.spawn = mock(() => ({
        stdin: { write: stdinWrite, end: stdinEnd },
        stdout: makeStdout('{"decision":"allow"}'),
        stderr: makeStdout(""),
        exited: Promise.resolve(0),
      })) as any

      const c = new HarnessClient("/bin/adapter")
      await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: { command: "ls" },
        event_type: "before",
      })

      expect(stdinWrite).toHaveBeenCalledTimes(1)
      const calls = stdinWrite.mock.calls as unknown as string[][]
      const written = calls[0]?.[0] ?? ""
      const parsed = JSON.parse(written)
      expect(parsed.trajectory_id).toBe("t1")
      expect(parsed.args.command).toBe("ls")
      expect(stdinEnd).toHaveBeenCalledTimes(1)
    })

    it("spawns with correct binary and command", async () => {
      const mockSpawn = makeMockSpawn(0, '{"decision":"allow"}')
      Bun.spawn = mockSpawn as any

      const c = new HarnessClient("/custom/adapter-bin")
      await c.adjudicate({
        trajectory_id: "t1",
        agent_id: "a1",
        tool: "bash",
        action: "ShellCommand",
        args: {},
        event_type: "before",
      })

      const calls = mockSpawn.mock.calls as unknown as Record<string, unknown>[][]
      const call = calls[0]?.[0] ?? {}
      expect(call.cmd).toEqual(["/custom/adapter-bin", "adjudicate"])
    })
  })

  describe("health", () => {
    it("returns true when adapter exits 0", async () => {
      Bun.spawn = mock(() => ({
        stdout: makeStdout(""),
        stderr: makeStdout(""),
        exited: Promise.resolve(0),
      })) as any

      const c = new HarnessClient("/bin/adapter")
      expect(await c.health()).toBe(true)
    })

    it("returns false when adapter exits non-zero", async () => {
      Bun.spawn = mock(() => ({
        stdout: makeStdout(""),
        stderr: makeStdout(""),
        exited: Promise.resolve(1),
      })) as any

      const c = new HarnessClient("/bin/adapter")
      expect(await c.health()).toBe(false)
    })

    it("returns false when spawn throws", async () => {
      Bun.spawn = mock(() => {
        throw new Error("ENOENT")
      }) as any

      const c = new HarnessClient("/nonexistent")
      expect(await c.health()).toBe(false)
    })
  })
})
