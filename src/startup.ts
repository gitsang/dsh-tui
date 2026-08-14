/**
 * The dsh-tui command-line provider: parses the TUI's flags and optional
 * initial prompt, then publishes {@link TUI_STARTUP_SERVICE}. The surface is
 * an ordinary consumer that reads the published values.
 * @module @gitsang/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the TUI surface. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the surface reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Working directory for the agent. */
  cwd: string
  /** Optional session id to resume instead of creating a fresh session. */
  resume?: string
  /** Optional initial prompt to run before entering the interactive loop. */
  prompt?: string
}

function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Run DeepSeek Harness as an interactive terminal agent.')
    .helpOption('-h, --help', 'show this help')
    .option('--cwd <path>', 'working directory for the agent (default: current directory)')
    .option('--resume <session>', 'resume an existing session by id')
    .argument('[prompt...]', 'optional initial prompt; multiple words are joined by spaces')
    .addHelpText('after', `
Examples:
  dsh --profile tui                     start an interactive session here
  dsh --profile tui "fix the tests"     start with an initial task
  dsh --profile tui --resume <id>       resume a previous session
`)
}

/**
 * Parse and provide the TUI invocation as an ordinary Cordis service. The
 * command's action publishes the values; on `--help` or a rejected invocation
 * nothing is provided and the launcher exits, so the surface never mounts.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const opts = program.opts<{ cwd?: string; resume?: string }>()
    const prompt = program.args.join(' ')
    ctx.provide(TUI_STARTUP_SERVICE, {
      cwd: opts.cwd ?? process.cwd(),
      resume: opts.resume,
      prompt: prompt === '' ? undefined : prompt,
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
