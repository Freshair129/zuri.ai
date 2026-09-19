// A minimal NDJSON MCP server standing in for MSP, used only to report what
// environment the spawned child actually received. Every tools/call answers
// with the child's own environment variable names.
function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

let input = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  for (;;) {
    const newline = input.indexOf('\n');
    if (newline < 0) return;
    const body = input.subarray(0, newline).toString('utf8').replace(/\r$/, '');
    input = input.subarray(newline + 1);
    const message = JSON.parse(body);
    if (message.method === 'initialize') {
      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'env-report-msp', version: '1' } } });
    } else if (message.method === 'tools/call') {
      const structuredContent = { names: Object.keys(process.env) };
      write({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent } });
    }
  }
});
