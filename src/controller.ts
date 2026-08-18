/**
 * TuiController: owns the live agent, the view model, slash-command dispatch,
 * session resume/fork, and the approval answerer. It keeps the current agent
 * swappable so `/resume` and `/fork` can hand the UI a different session.
 * @module @gitsang/dsh-tui/controller
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition, CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { SessionModel } from './model.js'
import type { TuiStartupValues } from './startup.js'

export interface AgentsLike {
  create(options: unknown): Promise<AgentHandle>
  resume(options: unknown): Promise<AgentHandle>
}

export interface SessionsLike {
  flush(session: Session): Promise<unknown>
}

export interface DefaultModelLike {
  currentSelection(): { provider: string; model: string }
}

export interface PersistenceLike {
  list(signal?: AbortSignal): Promise<SessionHeader[]>
}

export interface TuiControllerDeps {
  ctx: Context
  agents: AgentsLike
  sessions: SessionsLike
  defaultModel: DefaultModelLike
  persistence?: PersistenceLike
  startup: TuiStartupValues
}

interface SettingsServiceLike {
  get(ns: string): unknown
}

interface LlmServiceLike {
  listConfigurableProviders(): LlmConfigurableProvider[]
}

function settingsValueAt(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * Read the current model's context window from the mounted dsh settings
 * document (settings.yaml). The llm service tells us which settings namespace
 * and path holds the provider profile, so this works without hard-coding the
 * pi-ai namespace.
 */
function readContextWindow(ctx: Context, provider: string, model: string): number | undefined {
  const settings = ctx.get('settings') as SettingsServiceLike | undefined
  const llm = ctx.get('llm') as LlmServiceLike | undefined
  if (settings === undefined || llm === undefined) return undefined
  for (const entry of llm.listConfigurableProviders()) {
    if (entry.provider !== provider) continue
    const section = settings.get(entry.settingsNs)
    const profile = entry.settingsPath.length === 0 ? section : settingsValueAt(section, entry.settingsPath)
    if (typeof profile !== 'object' || profile === null) continue
    const models = (profile as Record<string, unknown>).models
    if (!Array.isArray(models)) continue
    for (const modelInfo of models) {
      if (typeof modelInfo !== 'object' || modelInfo === null) continue
      const candidate = modelInfo as Record<string, unknown>
      if (candidate.id === model && typeof candidate.contextWindow === 'number') {
        return candidate.contextWindow
      }
    }
  }
  return undefined
}

/** The completed-turn prefix of a session: every event through the last `turn/end`. */
function completedTurnPrefix(events: readonly SessionEvent[]): SessionEvent[] {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'turn/end') return events.slice(0, i + 1)
  }
  return []
}

function relativeTime(epochMs: number): string {
  const minutes = Math.floor((Date.now() - epochMs) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatSessionHeader(header: SessionHeader, currentId: SessionId | undefined): string {
  const marker = header.id === currentId ? '*' : ' '
  const fork = header.parentSession !== undefined ? ' ⑂' : ''
  const id = String(header.id).slice(-8)
  const cwd = header.cwd ?? ''
  return `${marker} ${id}  ${relativeTime(header.createdAt)}${fork}  ${cwd}`
}

export class TuiController {
  readonly model = new SessionModel()

  private current: { agent: AgentHandle['agent']; handle: AgentHandle } | null = null
  private readonly commands: {
    execute(agent: unknown, line: string, signal: AbortSignal): Promise<CommandExecution | undefined>
    list(agent: unknown): readonly CommandDescriptor[]
    register(definition: CommandDefinition): () => void
  } | undefined
  private readonly makeSetup: (agentCtx: Context) => void
  private onExit: ((code: number) => void) | null = null

  constructor(private readonly deps: TuiControllerDeps) {
    const { ctx } = deps
    this.commands = ctx.get('commands')

    const selection = deps.defaultModel.currentSelection()
    this.makeSetup = (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    }

    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const current = this.current
      if (current !== null && session.id === current.agent.session.id) this.model.apply(event)
    })

    ctx.on('approval/request', (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> => {
      const current = this.current
      if (current !== null && req.agent === current.agent) {
        return this.model.askApproval({ toolName: req.toolName, reason: req.reason, callId: req.callId })
      }
      return next()
    })

    this.registerCommands()
  }

  get agent(): AgentHandle['agent'] | null {
    return this.current?.agent ?? null
  }

  get sessionId(): SessionId | undefined {
    return this.current?.agent.session.id
  }

  /** Working directory shown in the pi-style footer. */
  get cwd(): string {
    return this.deps.startup.cwd
  }

  /** Provider/model label shown on the right side of the pi-style footer. */
  get modelLabel(): string {
    const selection = this.deps.defaultModel.currentSelection()
    return `${selection.provider}/${selection.model}`
  }

  /** Context window of the current model, read from settings.yaml when available. */
  get contextWindow(): number | undefined {
    const selection = this.deps.defaultModel.currentSelection()
    return readContextWindow(this.deps.ctx, selection.provider, selection.model)
  }

  setOnExit(onExit: (code: number) => void): void {
    this.onExit = onExit
  }

  /** Create or resume the initial agent. */
  async start(): Promise<void> {
    const { startup, defaultModel } = this.deps
    const selection = defaultModel.currentSelection()
    const handle = startup.resume === undefined
      ? await this.deps.agents.create({
          sessionId: SessionId(`session-${randomUUID()}`),
          meta: { cwd: startup.cwd },
          agentOptions: { provider: selection.provider, model: selection.model },
          setup: this.makeSetup,
        })
      : await this.deps.agents.resume({
          resumeSessionId: SessionId(startup.resume),
          setup: this.makeSetup,
        })
    await handle.agent.whenIdle()
    this.switchTo(handle)
    if (startup.prompt !== undefined) this.submit(startup.prompt)
  }

  submit(text: string): void {
    const agent = this.current?.agent
    if (agent === undefined) return
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }

  cancel(): void {
    this.current?.agent.cancel({ kind: 'user' })
  }

  async shutdown(code: number): Promise<void> {
    const current = this.current
    this.current = null
    if (current !== null) {
      try { await this.deps.sessions.flush(current.agent.session) } catch { /* best-effort */ }
      try { await current.handle.dispose() } catch { /* best-effort */ }
    }
    this.onExit?.(code)
  }

  /** Dispatch a slash command and render its result. */
  async dispatchCommand(line: string): Promise<void> {
    const before = this.current
    if (before === null) return
    if (this.commands === undefined) {
      this.model.addNotice('slash commands are not available in this composition', true)
      return
    }
    let execution: CommandExecution | undefined
    try {
      execution = await this.commands.execute(before.agent, line, AbortSignal.timeout(120_000))
    } catch (error) {
      this.model.addNotice(`command failed: ${error instanceof Error ? error.message : String(error)}`, true)
      return
    }
    // A command that switched sessions (fork/resume) retires the previous agent
    // only now, after its command/run + command/done lifecycle events settled.
    if (this.current !== before) {
      await before.handle.dispose().catch(() => { /* best-effort */ })
    }
    if (execution === undefined) {
      this.model.addNotice(`unknown command: ${line}`, true)
      return
    }
    if (execution.result.kind === 'error') this.model.addNotice(`error: ${execution.result.text}`, true)
    else if (execution.result.text !== undefined && execution.result.text !== '') this.model.addNotice(execution.result.text)
  }

  private registerCommands(): void {
    if (this.commands === undefined) return
    const { defaultModel, startup } = this.deps

    this.commands.register({
      name: 'help',
      description: 'list commands',
      handler: () => ({ kind: 'success', text: this.helpText() }),
    })

    this.commands.register({
      name: 'sessions',
      description: 'list persisted sessions',
      handler: async () => ({ kind: 'success', text: await this.listSessionsText() }),
    })

    this.commands.register({
      name: 'resume',
      description: 'resume a session by id',
      input: { hint: '<session-id>' },
      handler: async (inv) => {
        try {
          const id = await this.resumeTo(inv.rawInput.trim())
          return { kind: 'success', text: `resumed session ${String(id).slice(-8)}` }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    })

    this.commands.register({
      name: 'fork',
      description: 'fork the current session into a new branch',
      handler: async () => {
        try {
          const id = await this.forkTo()
          return { kind: 'success', text: `forked to session ${String(id).slice(-8)}` }
        } catch (error) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    })
  }

  private helpText(): string {
    if (this.commands === undefined || this.current === null) return ''
    return this.commands.list(this.current.agent)
      .map((command) => `/${command.name.padEnd(10)} ${command.description}`)
      .join('\n')
  }

  private async listSessionsText(): Promise<string> {
    const currentId = this.sessionId
    if (this.deps.persistence === undefined) return '(session persistence is not available)'
    const headers = await this.deps.persistence.list()
    if (headers.length === 0) return '(no persisted sessions)'
    return headers.map((header) => formatSessionHeader(header, currentId)).join('\n')
  }

  private async resumeTo(id: string): Promise<SessionId> {
    if (id === '') throw new Error('/resume requires a session id (try /sessions)')
    const selection = this.deps.defaultModel.currentSelection()
    const handle = await this.deps.agents.resume({ resumeSessionId: SessionId(id), setup: this.makeSetup })
    await handle.agent.whenIdle()
    this.switchTo(handle)
    return handle.agent.session.id
  }

  private async forkTo(): Promise<SessionId> {
    const parent = this.current?.agent
    if (parent === undefined) throw new Error('no active session to fork')
    const seed = completedTurnPrefix(parent.session.events)
    const selection = this.deps.defaultModel.currentSelection()
    const handle = await this.deps.agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: parent.session.header.cwd ?? this.deps.startup.cwd, parentSession: parent.session.id },
      agentOptions: { provider: selection.provider, model: selection.model },
      setup: this.makeSetup,
      ...seed.length > 0 ? { seed } : {},
    })
    await handle.agent.whenIdle()
    this.switchTo(handle)
    return handle.agent.session.id
  }

  private switchTo(handle: AgentHandle): void {
    this.current = { agent: handle.agent, handle }
    this.model.reset()
    for (const event of handle.agent.session.events) this.model.apply(event)
    this.model.busy = false
  }
}
