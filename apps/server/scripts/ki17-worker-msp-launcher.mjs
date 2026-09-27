import { spawn } from 'node:child_process'
import { buildMspChildEnvironment } from '../src/modules/agent/msp-child-environment.mjs'

const child = spawn(
  '/opt/ki17/node/bin/node',
  ['apps/msp-server/bin/msp-server.mjs'],
  {
    cwd: '/opt/ki17/msp',
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
