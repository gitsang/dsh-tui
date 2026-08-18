/**
 * The ink terminal UI, styled after the Pi coding agent TUI:
 * dark, low-chroma backgrounds for user messages and tool executions, a
 * pi-statusline-style Tokyo Night footer, and a borderless input band.
 * @module @gitsang/dsh-tui/ui/app
 */

import { useState, useSyncExternalStore } from 'react'
import { Box, Text, useCursor, useInput, useStdout, type Key } from 'ink'
import stringWidth from 'string-width'
import type { Entry } from '../model.js'
import type { TuiController } from '../controller.js'
import { STATUSLINE_CONFIG } from './config.js'
import { Statusline } from './statusline.js'

/**
 * Palette borrowed from Pi's built-in dark theme so the terminal surface
 * feels familiar when moving between `pi` and `dsh --profile tui`.
 */
const THEME = {
  text: '#d4d4d4',
  gray: '#808080',
  dimGray: '#666666',
  darkGray: '#505050',
  userMessageBg: '#343541',
  toolPendingBg: '#282832',
  toolSuccessBg: '#283228',
  toolErrorBg: '#3c2828',
  accent: '#8abeb7',
  warning: '#ffff00',
  error: '#cc6666',
  success: '#b5bd68',
} as const

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= max ? single : `${single.slice(0, max)}…`
}

function matchesHotkey(key: Key, binding: string): boolean {
  const parts = binding.toLowerCase().split('+').map((part) => part.trim()).filter(Boolean)
  const ctrl = parts.includes('ctrl')
  const meta = parts.includes('meta')
  const shift = parts.includes('shift')
  if (key.ctrl !== ctrl || key.meta !== meta || key.shift !== shift) return false
  const keyName = parts.find((part) => part !== 'ctrl' && part !== 'meta' && part !== 'shift') ?? ''
  if (keyName === 'return' || keyName === 'enter') return key.return
  if (keyName === 'escape') return key.escape
  if (keyName === 'backspace') return key.backspace
  if (keyName === 'delete') return key.delete
  if (keyName === 'tab') return key.tab
  if (keyName === 'up') return key.upArrow
  if (keyName === 'down') return key.downArrow
  if (keyName === 'left') return key.leftArrow
  if (keyName === 'right') return key.rightArrow
  return false
}

/** Grapheme-aware text cursor helpers used by the input line. */
const graphemeSegmenter: Intl.Segmenter | undefined =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined

interface GraphemeSegment {
  index: number
  segment: string
}

function graphemeSegments(text: string): GraphemeSegment[] {
  const segments: GraphemeSegment[] = []
  if (graphemeSegmenter !== undefined) {
    for (const part of graphemeSegmenter.segment(text)) {
      segments.push({ index: part.index, segment: part.segment })
    }
    return segments
  }
  let index = 0
  for (const ch of text) {
    segments.push({ index, segment: ch })
    index += ch.length
  }
  return segments
}

function clampCursor(text: string, cursor: number): number {
  return Math.max(0, Math.min(cursor, text.length))
}

function moveCursorLeft(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  if (clamped === 0) return 0
  let previous = 0
  for (const { index } of graphemeSegments(text)) {
    if (index < clamped) previous = index
    else break
  }
  return previous
}

function moveCursorRight(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  if (clamped >= text.length) return text.length
  for (const { index } of graphemeSegments(text)) {
    if (index > clamped) return index
  }
  return text.length
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1)
  }
  return starts
}

function lineIndexAt(text: string, cursor: number): number {
  const starts = lineStarts(text)
  let line = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= cursor) line = i
    else break
  }
  return line
}

function cursorLineColumn(text: string, cursor: number): { line: number; column: number } {
  const clamped = clampCursor(text, cursor)
  const line = lineIndexAt(text, clamped)
  const lineStart = lineStarts(text)[line]!
  return { line, column: stringWidth(text.slice(lineStart, clamped)) }
}

function columnToIndex(line: string, column: number): number {
  let width = 0
  let position = 0
  for (const { index, segment } of graphemeSegments(line)) {
    const w = stringWidth(segment)
    if (width + w > column) break
    width += w
    position = index + segment.length
  }
  return position
}

function moveCursorUp(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  const starts = lineStarts(text)
  if (starts.length <= 1) return clamped
  const { line, column } = cursorLineColumn(text, clamped)
  if (line === 0) return clamped
  const previousStart = starts[line - 1]!
  const previousLine = text.slice(previousStart, starts[line]! - 1)
  return previousStart + columnToIndex(previousLine, column)
}

function moveCursorDown(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  const starts = lineStarts(text)
  if (starts.length <= 1) return clamped
  const { line, column } = cursorLineColumn(text, clamped)
  if (line >= starts.length - 1) return clamped
  const nextStart = starts[line + 1]!
  const nextLine = text.slice(nextStart, line + 2 < starts.length ? starts[line + 2]! - 1 : text.length)
  return nextStart + columnToIndex(nextLine, column)
}

function moveCursorLineStart(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  return lineStarts(text)[lineIndexAt(text, clamped)]!
}

function moveCursorLineEnd(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  const starts = lineStarts(text)
  const line = lineIndexAt(text, clamped)
  return line + 1 < starts.length ? starts[line + 1]! - 1 : text.length
}

function moveCursorWordLeft(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  const before = text.slice(0, clamped)
  const match = before.match(/(?:\S+\s*|\s+)$/)
  return match === null ? 0 : clamped - match[0].length
}

function moveCursorWordRight(text: string, cursor: number): number {
  const clamped = clampCursor(text, cursor)
  const after = text.slice(clamped)
  const match = after.match(/^\s*\S+/)
  return match === null ? text.length : clamped + match[0].length
}

interface InputEdit {
  text: string
  cursor: number
}

function insertText(text: string, cursor: number, insert: string): InputEdit {
  const clamped = clampCursor(text, cursor)
  return {
    text: text.slice(0, clamped) + insert + text.slice(clamped),
    cursor: clamped + insert.length,
  }
}

function deleteBeforeCursor(text: string, cursor: number): InputEdit {
  const clamped = clampCursor(text, cursor)
  const start = moveCursorLeft(text, clamped)
  return { text: text.slice(0, start) + text.slice(clamped), cursor: start }
}

function deleteAtCursor(text: string, cursor: number): InputEdit {
  const clamped = clampCursor(text, cursor)
  const end = moveCursorRight(text, clamped)
  return { text: text.slice(0, clamped) + text.slice(end), cursor: clamped }
}

function deleteWordBefore(text: string, cursor: number): InputEdit {
  const clamped = clampCursor(text, cursor)
  const before = text.slice(0, clamped)
  const match = before.match(/(?:\S+\s*|\s+)$/)
  if (match === null) return { text, cursor: clamped }
  const start = clamped - match[0].length
  return { text: text.slice(0, start) + text.slice(clamped), cursor: start }
}

function deleteToLineStart(text: string, cursor: number): InputEdit {
  const clamped = clampCursor(text, cursor)
  const start = lineStarts(text)[lineIndexAt(text, clamped)]!
  return { text: text.slice(0, start) + text.slice(clamped), cursor: start }
}

function deleteToLineEnd(text: string, cursor: number): InputEdit {
  const clamped = clampCursor(text, cursor)
  const starts = lineStarts(text)
  const line = lineIndexAt(text, clamped)
  const lineTextEnd = line + 1 < starts.length ? starts[line + 1]! - 1 : text.length
  // At the end of a non-final line, Ctrl-K kills the newline as well.
  const end = clamped === lineTextEnd && line + 1 < starts.length ? starts[line + 1]! : lineTextEnd
  return { text: text.slice(0, clamped) + text.slice(end), cursor: clamped }
}

/** Replace the home directory with `~` for a compact footer cwd. */
function compactCwd(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home !== undefined && (cwd === home || cwd.startsWith(`${home}/`))) {
    return `~${cwd.slice(home.length)}`
  }
  return cwd
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.kind === 'message') {
    if (entry.role === 'user') {
      return (
        <Box backgroundColor={THEME.userMessageBg} paddingX={1} paddingY={1}>
          <Text color={THEME.text}>{entry.text}</Text>
        </Box>
      )
    }
    if (entry.role === 'context') {
      return (
        <Text color={entry.error === true ? THEME.error : THEME.gray}>
          {entry.error === true ? '✗ ' : '· '}
          {entry.text}
        </Text>
      )
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        {entry.reasoning !== undefined && entry.reasoning !== '' && (
          <Text italic color={THEME.gray}>{entry.reasoning}</Text>
        )}
        <Text color={THEME.text}>{entry.text}{entry.streaming ? ' ▌' : ''}</Text>
      </Box>
    )
  }

  const background = entry.status === 'running'
    ? THEME.toolPendingBg
    : entry.status === 'error' ? THEME.toolErrorBg : THEME.toolSuccessBg

  return (
    <Box backgroundColor={background} paddingX={1} paddingY={1} flexDirection="column">
      <Text>
        <Text color={THEME.text} bold>{entry.name}</Text>
        <Text color={THEME.gray}> {truncate(entry.args, 120)}</Text>
      </Text>
      {entry.status === 'error' && entry.errorCode !== undefined && (
        <Text color={THEME.error}>  ↳ error: {entry.errorCode}</Text>
      )}
      {entry.status === 'done' && entry.result !== undefined && entry.result !== '' && (
        <Text color={THEME.gray}>  ↳ {truncate(entry.result, 160)}</Text>
      )}
    </Box>
  )
}

export interface AppProps {
  controller: TuiController
}

export function App({ controller }: AppProps) {
  const model = controller.model
  const { stdout } = useStdout()
  const { setCursorPosition } = useCursor()
  useSyncExternalStore(model.subscribe, model.getSnapshot)
  const [inputState, setInputState] = useState<InputEdit>({ text: '', cursor: 0 })
  const [showHelp, setShowHelp] = useState(false)
  const input = inputState.text
  const cursor = inputState.cursor

  const submitInput = () => {
    const text = input.trim()
    setInputState({ text: '', cursor: 0 })
    setShowHelp(false)
    if (text === '') return
    if (text === ':q' || text === ':quit' || text === ':exit' || text === '/quit' || text === '/q') {
      void controller.shutdown(0)
      return
    }
    if (text === ':h' || text === ':help') {
      setShowHelp(true)
      return
    }
    if (text.startsWith('/')) {
      void controller.dispatchCommand(text).catch((error: unknown) => {
        model.addNotice(error instanceof Error ? error.message : String(error), true)
      })
      return
    }
    if (text.startsWith(':')) return
    controller.submit(text)
  }

  useInput((value, key) => {
    if (key.eventType === 'release') return

    if (key.ctrl && value === 'c') {
      if (model.busy) controller.cancel()
      else void controller.shutdown(0)
      return
    }
    if (model.pendingApproval !== null) {
      if (value === 'y' || value === 'Y') model.answerApproval('allowed-once')
      else if (value === 'n' || value === 'N' || key.return) model.answerApproval('rejected')
      return
    }
    if (matchesHotkey(key, STATUSLINE_CONFIG.keys.send) || (key.ctrl && value === 's')) {
      submitInput()
      return
    }
    if (matchesHotkey(key, STATUSLINE_CONFIG.keys.newline)) {
      setInputState((prev) => insertText(prev.text, prev.cursor, '\n'))
      return
    }
    if (key.escape) {
      setInputState({ text: '', cursor: 0 })
      return
    }

    // Emacs/readline-style cursor movement. Arrow keys match the same moves;
    // Up/Down move between lines of a multi-line input.
    if (key.ctrl && value === 'b') {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorLeft(prev.text, prev.cursor) }))
      return
    }
    if (key.ctrl && value === 'f') {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorRight(prev.text, prev.cursor) }))
      return
    }
    if (key.ctrl && value === 'a') {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorLineStart(prev.text, prev.cursor) }))
      return
    }
    if (key.ctrl && value === 'e') {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorLineEnd(prev.text, prev.cursor) }))
      return
    }
    if (key.ctrl && value === 'p') {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorUp(prev.text, prev.cursor) }))
      return
    }
    if (key.ctrl && value === 'n') {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorDown(prev.text, prev.cursor) }))
      return
    }
    if ((key.ctrl && key.leftArrow) || (key.meta && value === 'b')) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorWordLeft(prev.text, prev.cursor) }))
      return
    }
    if ((key.ctrl && key.rightArrow) || (key.meta && value === 'f')) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorWordRight(prev.text, prev.cursor) }))
      return
    }
    if (key.leftArrow) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorLeft(prev.text, prev.cursor) }))
      return
    }
    if (key.rightArrow) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorRight(prev.text, prev.cursor) }))
      return
    }
    if (key.upArrow) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorUp(prev.text, prev.cursor) }))
      return
    }
    if (key.downArrow) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorDown(prev.text, prev.cursor) }))
      return
    }
    if (key.home) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorLineStart(prev.text, prev.cursor) }))
      return
    }
    if (key.end) {
      setInputState((prev) => ({ text: prev.text, cursor: moveCursorLineEnd(prev.text, prev.cursor) }))
      return
    }

    // Readline-style deletion shortcuts.
    if (key.backspace || (key.ctrl && value === 'h')) {
      setInputState((prev) => deleteBeforeCursor(prev.text, prev.cursor))
      return
    }
    if (key.delete || (key.ctrl && value === 'd')) {
      setInputState((prev) => deleteAtCursor(prev.text, prev.cursor))
      return
    }
    if (key.ctrl && value === 'u') {
      setInputState((prev) => deleteToLineStart(prev.text, prev.cursor))
      return
    }
    if (key.ctrl && value === 'k') {
      setInputState((prev) => deleteToLineEnd(prev.text, prev.cursor))
      return
    }
    if (key.ctrl && value === 'w') {
      setInputState((prev) => deleteWordBefore(prev.text, prev.cursor))
      return
    }

    if (key.tab) return
    if (key.pageUp || key.pageDown) return
    if (value !== '' && !key.ctrl && !key.meta) {
      setInputState((prev) => insertText(prev.text, prev.cursor, value))
    }
  })

  const columns = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24
  const approvalLines = model.pendingApproval !== null ? 3 : 0
  const helpLines = showHelp ? 10 : 0
  const inputLineCount = Math.max(1, input.split('\n').length)
  const inputLines = inputLineCount + 2
  const footerLines = 5
  const visible = Math.max(1, rows - inputLines - footerLines - approvalLines - helpLines)
  const entries = model.entries.slice(-visible)

  const cwd = compactCwd(controller.cwd)
  const contextWindow = controller.contextWindow ?? STATUSLINE_CONFIG.contextWindow

  // Keep the terminal cursor on the input line. Terminal emulators place the
  // IME candidate window at the real terminal cursor; if left at the bottom of
  // the frame (after the footer), IME candidates appear below the footer.
  //
  // Ink's setCursorPosition coordinates are 0-based. The input area is
  // [top divider, text line, bottom divider], so the first text line sits at
  // y = visible + approvalLines + helpLines + 1.
  const cursorPos = cursorLineColumn(input, cursor)
  const inputCursorY = visible + approvalLines + helpLines + cursorPos.line + 1
  setCursorPosition({ x: 1 + cursorPos.column, y: inputCursorY })

  return (
    <Box flexDirection="column">
      {/* Always pin entries to the bottom of the fixed-height viewport. A single long
          streaming message can wrap past `visible` lines while `entries.length` is still
          small; flex-start would lay that overflowing child from the top and Ink would
          clip its tail, so the view would stay stuck on the head. flex-end keeps the
          latest/overflowing lines visible. */}
      <Box
        flexDirection="column"
        height={visible}
        overflowY="hidden"
        justifyContent="flex-end"
      >
        {entries.map((entry) => (
          <Box key={entry.kind === 'message' ? entry.id : entry.callId} flexShrink={0} flexDirection="column">
            <EntryRow entry={entry} />
          </Box>
        ))}
      </Box>

      {model.pendingApproval !== null && (
        <Box borderStyle="round" borderColor={THEME.warning} paddingX={1} marginY={1}>
          <Text color={THEME.warning} bold>⚠ approve {model.pendingApproval.prompt.toolName}?</Text>
          {model.pendingApproval.prompt.reason !== undefined && (
            <Text color={THEME.gray}> {model.pendingApproval.prompt.reason}</Text>
          )}
          <Text color={THEME.text}> [y/N]</Text>
        </Box>
      )}

      {showHelp && (
        <Box borderStyle="round" borderColor={THEME.darkGray} paddingX={1} marginY={1} flexDirection="column">
          <Text color={THEME.dimGray}>commands</Text>
          <Text color={THEME.dimGray}>  /help        list commands</Text>
          <Text color={THEME.dimGray}>  /sessions    list persisted sessions</Text>
          <Text color={THEME.dimGray}>  /resume SESSION-ID  resume a session</Text>
          <Text color={THEME.dimGray}>  /fork        fork the current session</Text>
          <Text color={THEME.dimGray}>  :quit, :q    exit</Text>
          <Text color={THEME.dimGray}>  Ctrl-C       cancel the running turn (or exit when idle)</Text>
          <Text color={THEME.dimGray}>  Ctrl-B/F, ←/→  move cursor; Ctrl-P/N, ↑/↓  move line</Text>
          <Text color={THEME.dimGray}>  Ctrl-A/E, Home/End  line start/end</Text>
          <Text color={THEME.dimGray}>  Ctrl-U/K/W  delete to start/end/word</Text>
        </Box>
      )}

      <Box flexDirection="column">
        <Text color={THEME.darkGray}>{'─'.repeat(Math.max(0, columns - 1))}</Text>
        <Box paddingX={1}>
          <Text color={THEME.text}>{input}{' '}</Text>
        </Box>
        <Text color={THEME.darkGray}>{'─'.repeat(Math.max(0, columns - 1))}</Text>
      </Box>

      <Statusline
        model={model}
        sessionId={controller.sessionId}
        cwd={cwd}
        modelLabel={controller.modelLabel}
        contextWindow={contextWindow}
        columns={columns}
      />
    </Box>
  )
}
