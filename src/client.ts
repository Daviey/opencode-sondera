import type { AdapterRequest, AdjudicationResponse } from "./types"

export class HarnessClient {
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
