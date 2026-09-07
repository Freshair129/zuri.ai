// A minimal NDJSON JSON-RPC server with MSP's framing, for
// tests/unit/msp-stdio-transport.test.js: answers initialize, echoes a
// tools/call's arguments as structuredContent, and returns an isError result
// for the tool named "fail". No dependencies, so the transport under test is
// the only code that matters.
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
      const result = name === 'fail'
        ? { isError: true, content: [{ type: 'text', text: 'gks_provider_unconfigured: no provider' }] }
        : { content: [{ type: 'text', text: JSON.stringify({ echoed: name, args }) }], structuredContent: { echoed: name, args } }
      write({ jsonrpc: '2.0', id: message.id, result })
    }
  }
})
