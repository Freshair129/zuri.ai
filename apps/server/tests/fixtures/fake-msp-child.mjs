// A stand-in for the MSP server, for tests/unit/ki17-worker-msp-launcher.test.js.
// No dependencies; it only reports what the launcher handed it.
//
//   report <exitCode> <NAME...>  print {names, values} on one line, then exit
//                                 with <exitCode>. `names` is every variable
//                                 NAME it received; `values` only the listed
//                                 ones, so a decoy value is never echoed.
//   wait <exitCode>              print FAKE_MSP_READY and stay up; on SIGTERM
//                                 print FAKE_MSP_SIGTERM and exit with <exitCode>.
const [mode, exitCode, ...names] = process.argv.slice(2)

if (mode === 'report') {
  const values = Object.fromEntries(names.map((name) => [name, process.env[name] ?? null]))
  process.stdout.write(`${JSON.stringify({ names: Object.keys(process.env), values })}\n`)
  process.exitCode = Number(exitCode)
} else if (mode === 'wait') {
  const keepAlive = setInterval(() => {}, 60_000)
  process.on('SIGTERM', () => {
    clearInterval(keepAlive)
    process.stdout.write('FAKE_MSP_SIGTERM\n')
    process.exitCode = Number(exitCode)
  })
  process.stdout.write('FAKE_MSP_READY\n')
} else {
  process.stderr.write(`fake-msp-child: unknown mode ${mode}\n`)
  process.exitCode = 2
}
