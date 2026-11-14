import { spawn } from "node:child_process"

export type CommandResult = {
  stdout: string
  stderr: string
}

export type RunOptions = {
  signal: AbortSignal
  cwd?: string
  input?: string
}

export class ExitError extends Error {
  constructor(
    readonly command: string,
    readonly stderr: string,
    readonly code: number | null,
  ) {
    super(stderr.trim().split("\n")[0] || `${command} exited with status ${String(code)}`)
  }
}

export function runProcess(command: string, args: readonly string[], options: RunOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      shell: false,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      signal: options.signal,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(0, 16 * 1024 * 1024)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 64 * 1024)
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new ExitError(command, stderr, code))
    })
    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    }
  })
}
