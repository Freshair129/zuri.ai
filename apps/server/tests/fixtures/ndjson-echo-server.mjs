// A minimal NDJSON JSON-RPC server with MSP's framing, for
// tests/unit/msp-stdio-transport.test.js: answers initialize, echoes a
// tools/call's arguments as structuredContent, and returns an isError result
// for the tool named "fail". No dependencies, so the transport under test is
// the only code that matters.
//
// The tool named "environment" reports what the transport handed this process:
// every variable NAME, and the values of only the names the caller lists — so a
// test can prove a decoy secret never arrived without the fixture ever echoing
// an unrequested value.
let input = Buffer.alloc(0)

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk])
  for (;;) {
    const newline = input.indexOf('\n')
    if (newline < 0) return
    const message = JSON.parse(input.subarray(0, newline).toString('utf8').replace(/\r$/, ''))
    input = input.subarray(newline + 1)
    if (message.method === 'initialize') {
      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ndjson-echo', version: '1' } } })
    } else if (message.method === 'tools/call') {
      const name = message.params?.name
      const args = message.params?.arguments ?? {}
      const structuredContent = name === 'environment'
        ? { names: Object.keys(process.env), values: Object.fromEntries((args.names ?? []).map((key) => [key, process.env[key] ?? null])) }
        : { echoed: name, args }
      const result = name === 'fail'
        ? { isError: true, content: [{ type: 'text', text: 'gks_provider_unconfigured: no provider' }] }
        : { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent }
      write({ jsonrpc: '2.0', id: message.id, result })
    }
  }
})
