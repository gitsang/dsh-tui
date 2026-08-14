# dsh-tui

Run [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) as an interactive coding agent in your terminal.

`dsh-tui` is a **bundle** (a Cordis plugin surface) that stacks on top of `@deepseek-ai/dsh-base` and adds a terminal UI. It is the third surface alongside the official `web` and `headless` profiles.

> ⚠️ DeepSeek Harness is in **developer preview** and iterates rapidly. This project pins `@deepseek-ai/dsh-*` to `0.1.0-rc.6`.

## How it works

`dsh` is "everything is a plugin". A running `dsh` is a Cordis plugin tree composed from ordered bundle patch layers. `dsh-tui` contributes two plugins:

| Plugin | Role |
|---|---|
| `tui-startup` | Injects `cmdlineArgs`, parses `--cwd` / `--resume` / `--raw` / initial prompt, publishes a `tuiStartup` service. |
| `tui-surface` | Creates/resumes an `Agent` through `ctx.agents`, reduces the session's `session/event` log into a view model, and renders it. |

There are two renderers over the same event stream:

- **ink TUI** (default, on a TTY): full-screen conversation + tool-call tree, approval modal, input line, and status bar.
- **raw** (`--raw`, or non-TTY): a plain readline loop with ANSI output.

## Prerequisites

- Node `^22.19 || >=24`
- [pnpm](https://pnpm.io/) (the `dsh` CLI forwards plugin management to pnpm)
- `DEEPSEEK_API_KEY` (or a provider configured in the dsh settings)

## Setup

```sh
# 1. Install the dsh CLI
npm install -g @deepseek-ai/dsh@0.1.0-rc.6

# 2. Build this bundle
pnpm install
pnpm build

# 3. Create the `tui` profile and link this bundle into it
#    (run from this repo root; `dsh plugin add .` anchors the path to your cwd)
dsh plugin --profile tui add .
```

`dsh --profile tui` auto-initializes the profile with `@deepseek-ai/dsh-base`, and `dsh plugin add` appends `@gitsang/dsh-tui` to its bundle list because this package declares `dsh.bundle`.

## Run

```sh
export DEEPSEEK_API_KEY=...

dsh --profile tui                          # interactive TUI in the current directory
dsh --profile tui "fix the failing tests"  # start with an initial task
dsh --profile tui --resume <session-id>    # resume a previous session
dsh --profile tui --cwd /path/to/repo      # work in a different directory
dsh --profile tui --raw                    # plain readline/ANSI instead of the TUI
```

### Controls

| Input | Action |
|---|---|
| any message + Enter | send to the agent |
| `:help` | show commands |
| `:quit` / `:q` | exit |
| `Ctrl-C` | cancel the running turn (or exit when idle) |
| `y` / `n` | answer a permission prompt (approve / reject) |

Permission prompts (`ctx.approval`) are answered in-terminal: the TUI registers an `approval/request` answerer and shows a modal. Raw mode has no answerer, so approvals fail closed (`unavailable`).

## Development

```sh
pnpm typecheck   # tsc --noEmit
pnpm build       # emit lib/ (js + .d.ts)
```

The dependency surface mirrors the official `@deepseek-ai/dsh-headless` bundle: `@deepseek-ai/dsh-agent`, `-llm`, `-session`, `-agent-default-model` are peer dependencies (resolved from the `dsh` installation), `@deepseek-ai/dsh-cmdline` is a direct dependency, and `ink` + `react` render the TUI.

## Roadmap

- [x] Phase 0 — minimal interactive readline surface
- [x] Phase 1 — ink TUI: conversation + tool tree, approval prompts, status bar, `--raw` mode
- [ ] Phase 2 — session list / resume picker, slash commands via `ctx.commands`, fork
- [ ] Phase 3 — publish `@gitsang/dsh-tui` to npm, add the `dsh-plugin` topic

## License

MIT
