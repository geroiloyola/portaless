// Regression for GHSA-27r3-jxmh-p828, isolated so an uncaught decoder error
// fails the child process rather than terminating the Vitest worker.
// Exercise body-parser resolved through the SDK's Express dependency, not an
// assertion that Portaless's custom MCP HTTP router uses Express middleware.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, request } from 'node:http';
import { deflateSync, gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const fromMcp = createRequire(new URL('../../packages/mcp-server/package.json', import.meta.url));
const fromSdk = createRequire(fromMcp.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'));
const fromExpress = createRequire(fromSdk.resolve('express'));
const parser = fromExpress('body-parser').json();
let deferredClient;
const server = createServer((req, res) => {
  if (req.url === '/health') { res.end('alive'); return; }
  parser(req, res, error => {
    if (error) { res.statusCode = error.status || 500; res.end('parse error'); return; }
    const reply = () => res.end(JSON.stringify(req.body));
    if (req.complete) reply(); else req.once('end', reply);
    if (deferredClient) {
      // The valid deflate frame has finished before the HTTP body has. These
      // bytes must not reach a finished decoder without an error listener.
      const client = deferredClient; deferredClient = undefined;
      client.end(Buffer.alloc(1024, 0x58));
    }
  });
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const { port } = server.address();

function send(encoding, compressed, trailing, deferTrailing) {
  return new Promise((resolve, reject) => {
    const first = Buffer.concat([compressed, Buffer.from([0])]);
    const client = request({ host: '127.0.0.1', port, path: '/', method: 'POST', agent: false,
      headers: { 'content-type': 'application/json', 'content-encoding': encoding,
        'content-length': first.length + trailing.length } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    client.on('error', reject);
    client.setTimeout(2000, () => client.destroy(new Error('compressed request timed out')));
    if (deferTrailing) { deferredClient = client; client.write(first); }
    else client.end(Buffer.concat([first, trailing]));
  });
}

try {
  const json = Buffer.from('{"ok":true}');
  const deflate = await send('deflate', deflateSync(json), Buffer.alloc(1024, 0x58), true);
  assert.deepEqual(deflate, { status: 200, body: json.toString() });
  const gzip = await send('gzip', gzipSync(json), Buffer.alloc(100 * 1024, 0x58), false);
  assert.deepEqual(gzip, { status: 200, body: json.toString() });
  // Late decoder errors must not kill the process after a successful response.
  await delay(100);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200); assert.equal(await health.text(), 'alive');
  console.log(JSON.stringify({ deflate: deflate.status, gzip: gzip.status, health: health.status }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
