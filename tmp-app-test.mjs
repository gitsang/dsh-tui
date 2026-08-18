import React from 'react'
import { render } from 'ink'
import { App } from './lib/ui/app.js'

const model = {
  entries: [],
  todos: [],
  turn: 0,
  step: 0,
  busy: false,
  pendingApproval: null,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  timing: { ttft: null, tps: null },
  timingAvg: { ttft: null, tps: null },
  subscribe: () => () => {},
  getSnapshot: () => 0,
}
const controller = {
  model,
  sessionId: 'session-12345678',
  cwd: '/tmp',
  modelLabel: 'provider/model',
  contextWindow: 65536,
  shutdown: () => {},
  cancel: () => {},
  submit: () => {},
  dispatchCommand: async () => {},
}
const instance = render(React.createElement(App, { controller }), {
  stdout: process.stdout,
  stdin: process.stdin,
  stderr: process.stderr,
  exitOnCtrlC: false,
  incrementalRendering: true,
})
setTimeout(() => {
  instance.unmount()
  setTimeout(() => process.exit(0), 50)
}, 500)
