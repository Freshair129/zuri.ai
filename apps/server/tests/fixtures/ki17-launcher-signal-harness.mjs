// Runs scripts/ki17-worker-msp-launcher.mjs in this process and, when a line
// arrives on stdin, emits SIGTERM to this process the way the OS would deliver
// it. For tests/unit/ki17-worker-msp-launcher.test.js on Windows, where a
// signal sent from another process terminates the target without running its
// handlers, so the launcher's forwarding can only be exercised from inside.
// Arguments after this script are the launcher's own.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/ki17-worker-msp-launcher.mjs')
process.stdin.once('data', () => {
  process.stdin.destroy()
  process.emit('SIGTERM', 'SIGTERM')
})
await import(pathToFileURL(launcher).href)
