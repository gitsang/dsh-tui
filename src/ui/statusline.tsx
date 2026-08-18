/**
 * Tokyo Night statusline, modeled after pi's `pi-statusline` extension.
 * Lines: state/session/model, cwd, tokens/cost + ctx window, ttft/speed
 * averages, turn/step.
 * @module @gitsang/dsh-tui/ui/statusline
 */

import { Box, Text } from 'ink'
import type { SessionModel } from '../model.js'
import { STATUSLINE_CONFIG } from './config.js'

const ICONS = STATUSLINE_CONFIG.icons
const PRICING = STATUSLINE_CONFIG.pricing

/** Tokyo Night palette used by pi-statusline. */
const P = {
  fg: '#c0caf5',
  white: '#ffffff',
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

function costDollars(model: SessionModel): number {
  return (model.usage.input / 1_000_000) * PRICING.input
    + (model.usage.output / 1_000_000) * PRICING.output
    + (model.usage.cacheRead / 1_000_000) * PRICING.cacheRead
    + (model.usage.cacheWrite / 1_000_000) * PRICING.cacheWrite
}

function contextTokens(model: SessionModel): number {
  return model.usage.input + model.usage.output + model.usage.cacheRead + model.usage.cacheWrite
}

function contextPercent(model: SessionModel, contextWindow: number): number | null {
  if (contextWindow <= 0) return null
  return Math.min(100, (contextTokens(model) / contextWindow) * 100)
}

function contextBarColor(pct: number | null): string {
  if (pct === null) return P.white
  if (pct >= 80) return P.red
  if (pct >= 50) return P.yellow
  return P.white
}

function contextBar(pct: number | null): string {
  const cells = 8
  const filled = pct === null ? 0 : Math.round((pct / 100) * cells)
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

export interface StatuslineProps {
  model: SessionModel
  sessionId: string | undefined
  cwd: string
  modelLabel: string
  contextWindow: number
  columns: number
}

export function Statusline({ model, sessionId, cwd, modelLabel, contextWindow, columns }: StatuslineProps) {
  const state = model.busy ? 'gen' : 'idle'
  const stateColor = state === 'gen' ? P.cyan : P.comment
  const stateIcon = state === 'gen' ? ICONS.stateGen : ICONS.stateIdle

  const input = fmtTok(model.usage.input)
  const output = fmtTok(model.usage.output)
  const cacheRead = fmtTok(model.usage.cacheRead)
  const cacheWrite = fmtTok(model.usage.cacheWrite)
  const cacheHit = fmtPct(cacheHitPercent(model))
  const cost = costDollars(model)

  const ctxPct = contextPercent(model, contextWindow)
  const ctxNums = `${fmtTok(contextTokens(model))}/${fmtTok(contextWindow)}`
  const barColor = contextBarColor(ctxPct)
  const bar = contextBar(ctxPct)

  const avg = model.timingAvg
  const stepLabel = model.step > 0 ? ` · step ${model.step}` : ''

  return (
    <Box flexDirection="column">
      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text>
          <Text color={stateColor}>{stateIcon}</Text>
          <Text color={P.comment}> session {shortId(sessionId)}</Text>
        </Text>
        <Text color={P.blue}>{truncateEnd(modelLabel, Math.max(1, columns - 30))}</Text>
      </Box>

      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text color={P.fg} wrap="truncate">{truncateStart(cwd, Math.max(1, columns - 1))}</Text>
      </Box>

      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text>
          <Text color={P.cyan}>{ICONS.tokIn} {input}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.green1}>{ICONS.tokOut} {output}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.blue5}>{ICONS.cacheRead} {cacheRead}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.purple}>{ICONS.cacheWrite} {cacheWrite}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.yellow}>{ICONS.cacheHit} {cacheHit}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.orange}>{ICONS.cost} ${cost.toFixed(3)}</Text>
        </Text>
        <Text>
          <Text color={barColor}>[{bar}] {fmtPct(ctxPct)}</Text>
          <Text color={P.comment}> {ctxNums}</Text>
        </Text>
      </Box>

      <Box width={columns} justifyContent="space-between" flexDirection="row">
        <Text>
          <Text color={P.green}>ttft {fmtSec1(avg.ttft)}</Text>
          <Text color={P.comment}>  </Text>
          <Text color={P.cyan}>speed {fmtTps1(avg.tps)}</Text>
        </Text>
        <Text color={P.comment}>turn {model.turn}{stepLabel}</Text>
      </Box>
    </Box>
  )
}
