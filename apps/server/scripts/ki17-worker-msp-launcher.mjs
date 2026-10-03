import { spawn } from 'node:child_process'
import { buildMspChildEnvironment } from '../src/modules/agent/msp-child-environment.mjs'

// The pinned MSP server. Test seam, and the only one: an explicit
// `<command> [args...]` after this script replaces the target and runs it in
// the launcher's own working directory, so tests/unit/ki17-worker-msp-launcher.test.js
// can execute the launcher against a fake MSP child. The Compose overlay passes
// no extra argument (GENESIS_WORKER_MSP_ARGS names this script alone), and argv
// is set by the same trusted configuration that already chooses the command.
const [overrideCommand, ...overrideArgs] = process.argv.slice(2)
const target = overrideCommand
  ? { command: overrideCommand, args: overrideArgs, cwd: process.cwd() }
  : { command: '/opt/ki17/node/bin/node', args: ['apps/msp-server/bin/msp-server.mjs'], cwd: '/opt/ki17/msp' }

const child = spawn(
  target.command,
  target.args,
  {
    cwd: target.cwd,
    env: buildMspChildEnvironment(process.env),
    stdio: 'inherit',
    shell: false,
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  })
}

child.once('error', () => {
  console.error('KI17_MSP_CHILD_FAILED_TO_START')
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
})
