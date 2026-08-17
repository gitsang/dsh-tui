/**
 * The ink terminal UI: conversation, tool-call tree, approval modal, input
 * line, and status bar, driven by a {@link TuiController}.
 * @module @gitsang/dsh-tui/ui/app
 */

import { useState, useSyncExternalStore } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { Entry } from '../model.js'
import type { TuiController } from '../controller.js'

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length <= max ? single : `${single.slice(0, max)}…`
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.kind === 'message') {
    if (entry.role === 'user') {
      return <Text color="cyanBright">❯ {entry.text}</Text>
    }
    if (entry.role === 'context') {
      return <Text color={entry.error === true ? 'red' : 'gray'}>{entry.error === true ? '✗ ' : '· '}{entry.text}</Text>
    }
    return (
      <Box flexDirection="column">
        {entry.reasoning !== undefined && entry.reasoning !== '' && (
          <Text color="gray" dimColor>{entry.reasoning}</Text>
        )}
        <Text color="green">{entry.text}{entry.streaming ? ' ▌' : ''}</Text>
      </Box>
    )
  }

  const mark = entry.status === 'running' ? '…' : entry.status === 'error' ? '✗' : '✓'
  const markColor = entry.status === 'error' ? 'red' : entry.status === 'done' ? 'green' : 'yellow'
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="yellow">⚙ {entry.name}</Text>
        <Text color={markColor}> {mark}</Text>
        <Text color="gray"> {truncate(entry.args, 80)}</Text>
      </Text>
      {entry.status === 'error' && entry.errorCode !== undefined && (
        <Text color="red">  ↳ error: {entry.errorCode}</Text>
      )}
      {entry.status === 'done' && entry.result !== undefined && entry.result !== '' && (
        <Text color="gray">  ↳ {truncate(entry.result, 120)}</Text>
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
  useSyncExternalStore(model.subscribe, model.getSnapshot)
  const [input, setInput] = useState('')
  const [showHelp, setShowHelp] = useState(false)

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
    if (key.return) {
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

  const rows = stdout?.rows ?? 24
  const reserved = 3 + (model.pendingApproval !== null ? 2 : 0) + (showHelp ? 6 : 0)
  const visible = Math.max(1, rows - reserved)
  const entries = model.entries.slice(-visible)

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {entries.map((entry) => (
          <EntryRow key={entry.kind === 'message' ? entry.id : entry.callId} entry={entry} />
        ))}
      </Box>

      {model.pendingApproval !== null && (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
          <Text color="yellow" bold>⚠ approve {model.pendingApproval.prompt.toolName}?</Text>
          {model.pendingApproval.prompt.reason !== undefined && (
            <Text color="gray"> {model.pendingApproval.prompt.reason}</Text>
          )}
          <Text> [y/N]</Text>
        </Box>
      )}

      {showHelp && (
        <Box borderStyle="round" borderColor="gray" paddingX={1} marginY={1} flexDirection="column">
          <Text dimColor>commands</Text>
          <Text dimColor>  /help        list commands</Text>
          <Text dimColor>  /sessions    list persisted sessions</Text>
          <Text dimColor>  /resume SESSION-ID  resume a session</Text>
          <Text dimColor>  /fork        fork the current session</Text>
          <Text dimColor>  :quit, :q    exit</Text>
          <Text dimColor>  Ctrl-C       cancel the running turn (or exit when idle)</Text>
        </Box>
      )}

      <Box>
        <Text color="cyanBright">❯ </Text>
        <Text>{input}</Text>
      </Box>

      <Box>
        <Text dimColor>
          {controller.sessionId !== undefined ? `session ${String(controller.sessionId).slice(-8)} · ` : ''}
          turn {model.turn}{model.step > 0 ? ` · step ${model.step}` : ''} · {model.busy ? '● running' : '○ idle'}
        </Text>
        {model.todos.length > 0 && (
          <Text dimColor>
            {' '}· todo {model.todos.filter((todo) => todo.status === 'completed').length}/{model.todos.length}
          </Text>
        )}
      </Box>
    </Box>
  )
}
