import { spawn as spawnProcess, type ChildProcessWithoutNullStreams } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join as joinPath } from "node:path"
import { createInterface } from "node:readline"

type Listener<T> = (payload: T) => void
type CloseEvent = { code: number | null; signal: number | null }

class LineStream {
  private listener: Listener<string> | null = null
  on(_event: "data", listener: Listener<string>): void {
    this.listener = listener
  }
  emit(line: string): void {
    this.listener?.(line)
  }
}

export class Child {
  constructor(private readonly proc: ChildProcessWithoutNullStreams) {}
  async write(data: string): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.proc.stdin.write(data, (err) => (err ? reject(err) : resolve())),
    )
  }
  async kill(): Promise<void> {
    this.proc.kill()
  }
}

export class Command {
  readonly stdout = new LineStream()
  readonly stderr = new LineStream()
  private onClose: Listener<CloseEvent> | null = null
  private onError: Listener<string> | null = null

  private constructor(
    private readonly program: string,
    private readonly args: string[],
    private readonly env: Record<string, string>,
  ) {}

  static create(program: string, args: string[] = [], options: { env?: Record<string, string> } = {}): Command {
    return new Command(program, args, options.env ?? {})
  }

  on(event: "close", listener: Listener<CloseEvent>): this
  on(event: "error", listener: Listener<string>): this
  on(event: "close" | "error", listener: Listener<never>): this {
    if (event === "close") this.onClose = listener as Listener<CloseEvent>
    else this.onError = listener as Listener<string>
    return this
  }

  async spawn(): Promise<Child> {
    const proc = spawnProcess(this.program, this.args, {
      env: { ...outsideClaudeCode(process.env), ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    if (process.env.LIVE_DEBUG) {
      proc.stdout.on("data", (chunk: Buffer) => process.stderr.write(`[cli] ${chunk}`))
    }
    createInterface({ input: proc.stdout }).on("line", (line) => this.stdout.emit(line))
    createInterface({ input: proc.stderr }).on("line", (line) => this.stderr.emit(line))
    proc.on("error", (err) => this.onError?.(err.message))
    proc.on("close", (code, signal) =>
      this.onClose?.({ code, signal: signal === null ? null : 1 }),
    )
    return new Child(proc)
  }
}

// The app's CLI never runs nested in a Claude Code session; drop that session's markers.
const PARENT_SESSION_VAR = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PLUGIN_.*|CLAUDE_CODE_(?!USE_|OAUTH_TOKEN).*)$/

function outsideClaudeCode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !PARENT_SESSION_VAR.test(key)))
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf-8")
}

export async function tempDir(): Promise<string> {
  return tmpdir()
}

export async function join(...parts: string[]): Promise<string> {
  return joinPath(...parts)
}
