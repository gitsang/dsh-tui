/**
 * SessionModel: reduces the session's append-only event stream into a small
 * view model the terminal UI renders. Mutations happen outside React (in the
 * `session/event` listener); React subscribes through `useSyncExternalStore`.
 * @module @gitsang/dsh-tui/model
 */

import type { ContentBlock, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

/** One conversation row: a message or a tool call. */
export type Entry =
  | {
      kind: 'message'
      id: string
      role: 'user' | 'assistant' | 'context'
      text: string
      reasoning?: string
      streaming: boolean
      error?: boolean
    }
  | {
      kind: 'tool'
      callId: string
      name: string
      args: string
      status: 'running' | 'done' | 'error'
      result?: string
      errorCode?: string
    }

export interface TodoView {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** A pending permission question shown to the user. */
export interface ApprovalPrompt {
  toolName: string
  reason?: string
  callId?: string
}

interface PendingApproval {
  prompt: ApprovalPrompt
  resolve: (outcome: ApprovalOutcome) => void
}

/** Cumulative token accounting shown in the statusline. */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Per-message TTFT/TPS and their session averages. */
export interface TimingStats {
  ttft: number | null
  tps: number | null
}

function blockText(block: ContentBlock): string | undefined {
  return block.type === 'text' || block.type === 'reasoning' ? block.text : undefined
}

export class SessionModel {
  entries: Entry[] = []
  todos: TodoView[] = []
  turn = 0
  step = 0
  busy = false
  pendingApproval: PendingApproval | null = null
  usage: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  timing: TimingStats = { ttft: null, tps: null }

  private version = 0
  private ttftHistory: number[] = []
  private tpsHistory: number[] = []
  private requestStart: number | null = null
  private firstToken: number | null = null
  private nextId = 0
  private listeners = new Set<() => void>()

  /** Stable subscription for `useSyncExternalStore`. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Session-average timing history, for the pi-style statusline. */
  get timingAvg(): TimingStats {
    const ttft = this.ttftHistory.length > 0
      ? this.ttftHistory.reduce((a, b) => a + b, 0) / this.ttftHistory.length
      : null
    const tps = this.tpsHistory.length > 0
      ? this.tpsHistory.reduce((a, b) => a + b, 0) / this.tpsHistory.length
      : null
    return { ttft, tps }
  }

  /** Monotonic snapshot; components read the mutable fields directly. */
  getSnapshot = (): number => this.version

  private notify(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  apply(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.turn = event.data.turn
        this.busy = true
        this.notify()
        return
      case 'step/start':
        this.step = event.data.step
        this.requestStart = event.time
        this.firstToken = null
        this.notify()
        return
      case 'turn/end':
        this.busy = false
        this.notify()
        return
      case 'user/message':
        this.pushUser(event.data.source.kind, event.data.content)
        return
      case 'assistant/chunk':
        if (event.data.chunk.type === 'text-delta' && this.firstToken === null) this.firstToken = event.time
        this.pushChunk(event.data.chunk)
        return
      case 'assistant/message':
        this.finishStreaming()
        this.recordUsage(event.data.usage)
        this.recordTiming(event.data.usage?.outputTokens ?? 0, event.time)
        return
      case 'tool/call':
        this.pushToolCall(event.data.callId, event.data.name, event.data.arguments)
        return
      case 'tool/result':
        this.finishToolResult(event.data)
        return
      case 'todo/write':
        this.todos = event.data.todos.map((todo) => ({ content: todo.content, status: todo.status }))
        this.notify()
        return
      default:
        return
    }
  }

  /** Present a permission question and wait for the user's answer. */
  askApproval(prompt: ApprovalPrompt): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      this.pendingApproval = { prompt, resolve }
      this.notify()
    })
  }

  /** Resolve a pending permission question. */
  answerApproval(outcome: ApprovalOutcome): void {
    const pending = this.pendingApproval
    this.pendingApproval = null
    pending?.resolve(outcome)
    this.notify()
  }

  /** Clear all state (used when switching sessions). */
  reset(): void {
    this.entries = []
    this.todos = []
    this.turn = 0
    this.step = 0
    this.busy = false
    this.pendingApproval = null
    this.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    this.timing = { ttft: null, tps: null }
    this.ttftHistory = []
    this.tpsHistory = []
    this.requestStart = null
    this.firstToken = null
    this.notify()
  }

  /** Append a UI-level notice (command output, errors). */
  addNotice(text: string, error = false): void {
    this.entries.push({ kind: 'message', id: `m-${this.nextId++}`, role: 'context', text, streaming: false, error })
    this.notify()
  }

  private pushUser(kind: string, content: readonly ContentBlock[]): void {
    const text = content.map((block) => blockText(block)).filter((t): t is string => t !== undefined).join('\n')
    if (text === '') return
    this.entries.push({
      kind: 'message',
      id: `m-${this.nextId++}`,
      role: kind === 'user' ? 'user' : 'context',
      text,
      streaming: false,
    })
    this.notify()
  }

  private recordUsage(usage: TokenUsage | undefined): void {
    if (usage === undefined) return
    this.usage.input += usage.inputTokens
    this.usage.output += usage.outputTokens
    this.usage.cacheRead += usage.cacheReadTokens ?? 0
    this.usage.cacheWrite += usage.cacheWriteTokens ?? 0
    this.notify()
  }

  private recordTiming(outputTokens: number, endTime: number): void {
    const started = this.requestStart
    const first = this.firstToken
    const ttft = started !== null && first !== null ? Math.max(0, first - started) : null
    const tps = first !== null && outputTokens > 0 && endTime > first ? outputTokens / ((endTime - first) / 1000) : null
    this.timing = { ttft, tps }
    if (ttft !== null) this.ttftHistory.push(ttft)
    if (tps !== null) this.tpsHistory.push(tps)
    this.notify()
  }

  private pushChunk(chunk: StreamChunk): void {
    if (chunk.type === 'text-delta') {
      this.streamingAssistant().text += chunk.text
      this.notify()
    } else if (chunk.type === 'reasoning-delta') {
      const message = this.streamingAssistant()
      message.reasoning = `${message.reasoning ?? ''}${chunk.text}`
      this.notify()
    }
  }

  private streamingAssistant(): Extract<Entry, { kind: 'message' }> {
    const last = this.entries[this.entries.length - 1]
    if (last?.kind === 'message' && last.role === 'assistant' && last.streaming) return last
    const message: Extract<Entry, { kind: 'message' }> = {
      kind: 'message',
      id: `m-${this.nextId++}`,
      role: 'assistant',
      text: '',
      streaming: true,
    }
    this.entries.push(message)
    return message
  }

  private finishStreaming(): void {
    const last = this.entries[this.entries.length - 1]
    if (last?.kind === 'message' && last.role === 'assistant') last.streaming = false
    this.notify()
  }

  private pushToolCall(callId: string, name: string, args: string): void {
    this.entries.push({ kind: 'tool', callId, name, args, status: 'running' })
    this.notify()
  }

  private finishToolResult(data: SessionEvent<'tool/result'>['data']): void {
    const resultBlock = data.message.content[0]
    const callId = resultBlock?.toolCallId
    if (callId === undefined) return
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]
      if (entry?.kind !== 'tool' || entry.callId !== callId) continue
      if (data.error !== undefined) {
        entry.status = 'error'
        entry.errorCode = data.error.code
      } else {
        entry.status = 'done'
        entry.result = (resultBlock.content ?? [])
          .map((block) => blockText(block))
          .filter((t): t is string => t !== undefined)
          .join(' ')
          .trim()
      }
      this.notify()
      return
    }
  }
}
