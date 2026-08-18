/**
 * dsh-tui UI configuration loaded from `~/.config/dsh-tui/statusline.json`.
 * Contains pi-statusline-compatible statusline icons and the configurable
 * input hotkeys.
 * @module @gitsang/dsh-tui/ui/config
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StatuslineIconConfig {
  stateIdle: string
  stateGen: string
  stateDone: string
  tokIn: string
  tokOut: string
  cacheRead: string
  cacheWrite: string
  cacheHit: string
  cost: string
}

export interface HotkeysConfig {
  /** Key binding that submits the input as a message. */
  send: string
  /** Key binding that inserts a newline into the input. */
  newline: string
}

export interface PricingConfig {
  /** USD per 1M input tokens (uncached). */
  input: number
  /** USD per 1M output tokens. */
  output: number
  /** USD per 1M cache-read tokens. */
  cacheRead: number
  /** USD per 1M cache-write tokens. */
  cacheWrite: number
}

export interface DshTuiConfig {
  icons: StatuslineIconConfig
  keys: HotkeysConfig
  pricing: PricingConfig
  /** Model context window used by the statusline ctx bar/pct/nums. */
  contextWindow: number
}

/**
 * Default statusline icons. These mirror pi-agent's current
 * `pi-statusline/config.json` glyphs.
 */
export const DEFAULT_STATUSLINE_ICONS: StatuslineIconConfig = {
  stateIdle: '\u{f0ef4} ',
  stateGen: '\uf110 ',
  stateDone: '\uf05d ',
  tokIn: '\uf01b',
  tokOut: '\uf01a',
  cacheRead: '\u{f125b}',
  cacheWrite: '\u{f1259}',
  cacheHit: '\uf49b',
  cost: '\uef8d',
}

/** Default input bindings: Ctrl+Enter sends, Enter inserts a newline. */
export const DEFAULT_HOTKEYS: HotkeysConfig = {
  send: 'ctrl+return',
  newline: 'return',
}

/** Default DeepSeek list-price USD per 1M tokens; override in config. */
export const DEFAULT_PRICING: PricingConfig = {
  input: 0.27,
  output: 1.10,
  cacheRead: 0.07,
  cacheWrite: 0.27,
}

/** Default context window; override per model in the statusline config. */
export const DEFAULT_CONTEXT_WINDOW = 65536

function configPath(): string | undefined {
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home === undefined) return undefined
  return join(home, '.config', 'dsh-tui', 'statusline.json')
}

function loadConfig(): DshTuiConfig {
  const path = configPath()
  const base: DshTuiConfig = {
    icons: { ...DEFAULT_STATUSLINE_ICONS },
    keys: { ...DEFAULT_HOTKEYS },
    pricing: { ...DEFAULT_PRICING },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  }
  if (path === undefined) return base
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      icons?: Partial<StatuslineIconConfig>
      keys?: Partial<HotkeysConfig>
      pricing?: Partial<PricingConfig>
      contextWindow?: number
    }
    return {
      icons: { ...base.icons, ...(parsed.icons ?? {}) },
      keys: { ...base.keys, ...(parsed.keys ?? {}) },
      pricing: { ...base.pricing, ...(parsed.pricing ?? {}) },
      contextWindow: typeof parsed.contextWindow === 'number' ? parsed.contextWindow : base.contextWindow,
    }
  } catch {
    return base
  }
}

/** Loaded once at module load; restart dsh-tui after editing the config. */
export const STATUSLINE_CONFIG = loadConfig()
