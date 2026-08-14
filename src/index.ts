/**
 * @gitsang/dsh-tui — an interactive terminal surface over dsh-base. It mounts
 * no Host, HTTP server, or browser plugins. The surface creates (or resumes)
 * one Agent through the core registry, streams its SessionEvent log into a
 * view model, and drives it from either a full-screen ink UI or a plain
 * readline loop (`--raw` / non-TTY).
 * @module @gitsang/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import * as readline from 'node:readline/promises'
import { stdin, stdout, stderr } from 'node:process'
import { createElement } from 'react'
import { render } from 'ink'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { SessionModel } from './model.js'
import { Renderer } from './render.js'
import { App } from './ui/app.js'
import { TUI_STARTUP_SERVICE, type TuiStartupValues } from './startup.js'

/** Stable Cordis plugin name. */
export const name = 'tui-surface'

/** Core services required before the interactive loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Process-facing effects of the surface: streams plus the launcher's exit request. */
interface TuiIo {
  input: NodeJS.ReadableStream
  output: NodeJS.WritableStream
  error: NodeJS.WritableStream
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process streams the surface writes to; tests substitute captures. */
export const internals: { input: TuiIo['input']; output: TuiIo['output']; error: TuiIo['error'] } = {
  input: stdin,
  output: stdout,
  error: stderr,
}

/** Report an unexpected surface failure and request a failing exit. */
function fail(io: TuiIo, error: unknown): void {
  io.error.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/** Build the agent-scoped model selection used at creation and resume time. */
function makeSetup(selection: { provider: string; model: string }) {
  return (agentCtx: Context): void => {
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }
}

/** Mount the interactive terminal surface. */
export function apply(ctx: Context): void {
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined
  if (exit === undefined) {
    throw new Error('tui-surface: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { input: internals.input, output: internals.output, error: internals.error, exit }
  void run(ctx, io).catch((error: unknown) => { fail(io, error) })
}

interface BootedAgent {
  agent: AgentHandle['agent']
  handle: AgentHandle
  sessions: { flush(session: Session): Promise<unknown> }
  startup: TuiStartupValues
}

async function run(ctx: Context, io: TuiIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  const startup = ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined
  if (agents === undefined || defaultModel === undefined || sessions === undefined || startup === undefined) {
    io.error.write('dsh: tui-surface: missing core services\n')
    io.exit(1)
    return
  }

  const selection = defaultModel.currentSelection()
  const setup = makeSetup(selection)

  let handle: AgentHandle
  try {
    handle = startup.resume === undefined
      ? await agents.create({
          sessionId: SessionId(`session-${randomUUID()}`),
          meta: { cwd: startup.cwd },
          agentOptions: { provider: selection.provider, model: selection.model },
          setup,
        })
      : await agents.resume({
          resumeSessionId: SessionId(startup.resume),
          setup,
        })
  } catch (error) {
    fail(io, error)
    return
  }

  const booted: BootedAgent = { agent: handle.agent, handle, sessions, startup }
  await booted.agent.whenIdle()

  const useRaw = startup.raw === true || process.stdout.isTTY !== true || process.stdin.isTTY !== true
  if (useRaw) await runRaw(ctx, io, booted)
  else await runTui(ctx, io, booted)
}

/** Plain readline + ANSI rendering for `--raw` and non-TTY runs. Approvals fail closed. */
async function runRaw(ctx: Context, io: TuiIo, booted: BootedAgent): Promise<void> {
  const { agent, handle, sessions, startup } = booted
  const renderer = new Renderer(io.output)

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session.id === agent.session.id) renderer.render(event)
  })

  const rl = readline.createInterface({ input: io.input, output: io.output, terminal: true })
  let busy = false

  const shutdown = async (code: number): Promise<void> => {
    rl.close()
    try {
      await sessions.flush(agent.session)
      await handle.dispose()
    } catch {
      // Teardown is best-effort; the process is exiting anyway.
    }
    io.exit(code)
  }

  process.on('SIGINT', () => {
    if (busy) {
      io.output.write('\n⏹ interrupting…\n')
      agent.cancel({ kind: 'user' })
    } else {
      io.output.write('\n')
      void shutdown(0)
    }
  })

  const submit = async (text: string): Promise<void> => {
    busy = true
    try {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    } finally {
      busy = false
    }
  }

  if (startup.prompt !== undefined) await submit(startup.prompt)

  for (;;) {
    const line = await rl.question('❯ ')
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (trimmed === ':q' || trimmed === ':quit' || trimmed === ':exit') {
      void shutdown(0)
      return
    }
    if (trimmed === ':h' || trimmed === ':help') {
      io.output.write('commands:\n  :help          show this help\n  :quit, :q      exit\n  anything else  send a message to the agent\n')
      continue
    }
    if (trimmed.startsWith(':')) {
      io.output.write(`dsh: unknown command ${JSON.stringify(trimmed)}\n`)
      continue
    }
    await submit(line)
  }
}

/** Full-screen ink UI with permission prompts. */
async function runTui(ctx: Context, io: TuiIo, booted: BootedAgent): Promise<void> {
  const { agent, handle, sessions, startup } = booted
  const model = new SessionModel()

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session.id === agent.session.id) model.apply(event)
  })

  // Terminal answerer for the approval seam: answer only for the owned agent,
  // delegate everything else (fail closed).
  ctx.on('approval/request', (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
    if (req.agent !== agent) return next()
    return model.askApproval({ toolName: req.toolName, reason: req.reason, callId: req.callId })
  })

  let instance: ReturnType<typeof render> | undefined

  const shutdown = async (code: number): Promise<void> => {
    try {
      await sessions.flush(agent.session)
      await handle.dispose()
    } catch {
      // Teardown is best-effort; the process is exiting anyway.
    }
    instance?.unmount()
    io.exit(code)
  }

  const onSubmit = (text: string): void => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }
  const onCancel = (): void => {
    agent.cancel({ kind: 'user' })
  }
  const onQuit = (): void => {
    void shutdown(0)
  }

  instance = render(
    createElement(App, { model, onSubmit, onCancel, onQuit }),
    {
      stdout: io.output as NodeJS.WriteStream,
      stdin: io.input as NodeJS.ReadStream,
      stderr: io.error as NodeJS.WriteStream,
      exitOnCtrlC: false,
    },
  )

  if (startup.prompt !== undefined) onSubmit(startup.prompt)

  await instance.waitUntilExit()
}
