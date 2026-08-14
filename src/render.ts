/**
 * Minimal ANSI renderer for the TUI surface: turns SessionEvents into colored
 * terminal output. Kept behind a small class so a richer widget layer
 * (ink / blessed) can replace it without touching the event pipeline.
 * @module @gitsang/dsh-tui/render
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const GRAY = '\x1b[90m'

/** Collapse whitespace and truncate a display string. */
function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  if (single.length <= max) return single
  return `${single.slice(0, max)}…`
}

/** Visible text from a content block, if it carries any. */
function blockText(block: ContentBlock): string | undefined {
  if (block.type === 'text' || block.type === 'reasoning') return block.text
  return undefined
}

/** Minimal writable sink, so the renderer accepts process streams or test captures. */
export interface OutputSink {
  write(chunk: string): unknown
}

export class Renderer {
  private atLineStart = true

  constructor(private readonly output: OutputSink) {}

  /** Terminate any open (streamed) line, then write a full line. */
  private line(text: string): void {
    if (!this.atLineStart) this.output.write('\n')
    this.output.write(`${text}\n`)
    this.atLineStart = true
  }

  /** Stream a fragment onto the current line. */
  private stream(text: string): void {
    this.output.write(text)
    this.atLineStart = false
  }

  render(event: SessionEvent): void {
    switch (event.type) {
      case 'user/message': {
        const text = event.data.content
          .map((block) => blockText(block))
          .filter((t): t is string => t !== undefined)
          .join('\n')
        if (text === '') return
        if (event.data.source.kind === 'user') {
          this.line(`${CYAN}❯ ${text}${RESET}`)
        } else {
          this.line(`${GRAY}· ${truncate(text, 120)}${RESET}`)
        }
        return
      }

      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type === 'text-delta') {
          this.stream(`${GREEN}${chunk.text}${RESET}`)
        } else if (chunk.type === 'reasoning-delta') {
          this.stream(`${DIM}${chunk.text}${RESET}`)
        }
        return
      }

      case 'assistant/message': {
        // Close the streamed line. Tool-call blocks are rendered by the
        // dedicated `tool/call` events, so nothing else to print here.
        if (!this.atLineStart) this.line('')
        return
      }

      case 'tool/call': {
        this.line(
          `${YELLOW}⚙ ${event.data.name}${RESET} ${GRAY}${truncate(event.data.arguments, 100)}${RESET}`,
        )
        return
      }

      case 'tool/result': {
        if (event.data.error !== undefined) {
          this.line(`${RED}↳ error: ${event.data.error.code}${RESET}`)
          return
        }
        const resultBlock = event.data.message.content[0]
        const text = (resultBlock?.content ?? [])
          .map((block) => blockText(block))
          .filter((t): t is string => t !== undefined)
          .join(' ')
        if (text !== '') this.line(`${GRAY}↳ ${truncate(text, 160)}${RESET}`)
        return
      }

      case 'turn/start': {
        this.line(`${DIM}──────────────────────────────────────────${RESET}`)
        return
      }

      case 'todo/write': {
        const done = event.data.todos.filter((todo) => todo.status === 'completed').length
        this.line(`${GRAY}☑ todo ${done}/${event.data.todos.length}${RESET}`)
        return
      }

      default:
        return
    }
  }
}
