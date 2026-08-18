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
  const [input, setInput] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  const submitInput = () => {
    const text = input.trim()
    setInput('')
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
      setInput((prev) => prev + '\n')
      return
    }
    if (key.escape) {
      setInput('')
      return
    }
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1))
      return
    }
    if (key.tab) return
    if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.pageUp || key.pageDown || key.home || key.end) return
    if (value !== '' && !key.ctrl && !key.meta) setInput((prev) => prev + value)
  })

  const columns = stdout?.columns ?? 80
  const rows = stdout?.rows ?? 24
  const approvalLines = model.pendingApproval !== null ? 3 : 0
  const helpLines = showHelp ? 7 : 0
  const inputLineCount = Math.max(1, input.split('\n').length)
  const inputLines = inputLineCount + 2
  const footerLines = 5
  const visible = Math.max(1, rows - inputLines - footerLines - approvalLines - helpLines)
  const entries = model.entries.slice(-visible)

  const cwd = compactCwd(controller.cwd)

  // Keep the terminal cursor on the input line. Terminal emulators place the
  // IME candidate window at the real terminal cursor; if left at the bottom of
  // the frame (after the footer), IME candidates appear below the footer.
  //
  // Ink renders fullscreen frames without a trailing newline, while its cursor
  // suffix calculation assumes the cursor starts one line below the last
  // rendered line. The extra +1 compensates for that assumption so the visible
  // terminal cursor lands on the input line rather than one line above it.
  const lastInputLine = input.split('\n').at(-1) ?? ''
  const inputCursorY = visible + approvalLines + helpLines + inputLineCount + 1
  setCursorPosition({ x: 1 + stringWidth(lastInputLine), y: inputCursorY })

  return (
    <Box flexDirection="column">
      <Box
        flexDirection="column"
        height={visible}
        overflowY="hidden"
        justifyContent={entries.length >= visible ? 'flex-end' : 'flex-start'}
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
        columns={columns}
      />
    </Box>
  )
}
