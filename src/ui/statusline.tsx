/**
 * Tokyo Night statusline, modeled after pi's `pi-statusline` extension.
 * dsh-tui currently has no extension status registry, cost, or context-window
 * accounting, so the default lines are the pi-statusline lines with those
 * unsupported modules dropped: state/session/model, cwd, token usage, and
 * TTFT/TPS timing.
 * @module @gitsang/dsh-tui/ui/statusline
 */

import { Box, Text } from 'ink'
import type { SessionModel } from '../model.js'

/** Tokyo Night palette used by pi-statusline. */
const P = {
  fg: '#c0caf5',
  comment: '#565f89',
  dark5: '#737aa2',
  blue: '#7aa2f7',
  cyan: '#7dcfff',
  blue5: '#89ddff',
  magenta: '#bb9af7',
  purple: '#9d7cd8',
  orange: '#ff9e64',
  yellow: '#e0af68',
  green: '#9ece6a',
  green1: '#73daca',
  red: '#f7768e',
} as const

function fmtTok(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1000000) return `${Math.round(n / 1000)}k`
  if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`
  return `${Math.round(n / 1000000)}M`
}

function fmtSec1(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`
}

function fmtTps1(tps: number | null): string {
  return tps === null ? '—' : `${tps.toFixed(1)} tok/s`
}

function fmtPct(n: number | null): string {
  return n === null ? '0%' : `${Math.round(n)}%`
}

function truncateEnd(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function truncateStart(text: string, max: number): string {
  if (text.length <= max) return text
  return `…${text.slice(-(max - 1))}`
}

function shortId(sessionId: string | undefined): string {
  return sessionId !== undefined ? String(sessionId).slice(-8) : '—'
}

function cacheHitPercent(model: SessionModel): number | null {
  const denom = model.usage.input + model.usage.cacheRead + model.usage.cacheWrite
  return denom > 0 ? (model.usage.cacheRead / denom) * 100 : null
}

export interface StatuslineProps {
  model: SessionModel
  sessionId: string | undefined
  cwd: string
  modelLabel: string
  columns: number
}

export function Statusline({ model, sessionId, cwd, modelLabel, columns }: StatuslineProps) {
  const state = model.busy ? 'gen' : 'idle'
  const stateColor = state === 'gen' ? P.cyan : P.comment
  const stateIcon = state === 'gen' ? '●' : '○'
  const stateLabel = state === 'gen' ? 'gen' : 'idle'

  const input = fmtTok(model.usage.input)
  const output = fmtTok(model.usage.output)
  const cacheRead = fmtTok(model.usage.cacheRead)
  const cacheWrite = fmtTok(model.usage.cacheWrite)
  const cacheHit = fmtPct(cacheHitPercent(model))

  const timing = model.timing
  const avg = model.timingAvg
  const stepLabel = model.step > 0 ? ` · step ${model.step}` : ''

  return (
    <Box flexDirection="column">
      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text>
          <Text color={stateColor}>{stateIcon} {stateLabel}</Text>
          <Text color={P.comment}> session {shortId(sessionId)}</Text>
        </Text>
        <Text color={P.blue}>{truncateEnd(modelLabel, Math.max(1, columns - 30))}</Text>
      </Box>

      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text color={P.fg} wrap="truncate">{truncateStart(cwd, Math.max(1, columns - 1))}</Text>
      </Box>

      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text>
          <Text color={P.cyan}>↑{input}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.green1}>↓{output}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.blue5}>R{cacheRead}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.purple}>W{cacheWrite}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.yellow}>CH{cacheHit}</Text>
        </Text>
        <Text color={P.comment}>turn {model.turn}{stepLabel}</Text>
      </Box>

      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text>
          <Text color={P.green}>ttft {fmtSec1(timing.ttft)}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.cyan}>speed {fmtTps1(timing.tps)}</Text>
        </Text>
        <Text color={P.comment}>
          avg ttft {fmtSec1(avg.ttft)} · avg speed {fmtTps1(avg.tps)}
        </Text>
      </Box>
    </Box>
  )
}
