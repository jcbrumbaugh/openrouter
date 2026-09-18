// Drives the gateway's model upload against stand-ins for Tripo and S3,
// including the region refusal S3 actually sent:
//
//   AuthorizationHeaderMalformed ... the region 'us-east-1' is wrong;
//   expecting 'us-west-2'
//
//   node tests/model-upload.test.mjs

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? `  ok  ${name}` : `FAIL  ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  ok ? (pass += 1) : (fail += 1);
};

const REAL_REGION = 'us-west-2';
const seen = { sts: [], puts: [] };

// Stands in for Tripo's API and for S3, on one port.
const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  if (req.url.endsWith('/upload/sts/token')) {
    seen.sts.push(JSON.parse(body.toString()));
    const port = fake.address().port;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      code: 0,
      data: {
        sts_ak: 'ASIA_TEST',
        sts_sk: 'secret-test',
        session_token: 'session-test',
        s3_host: `127.0.0.1:${port}`,
        resource_bucket: 'tripo-bucket',
        resource_uri: 'uploads/hero.fbx',
      },
    }));
    return;
  }

  if (req.method === 'PUT') {
    const auth = req.headers.authorization ?? '';
    const region = /\/\d{8}\/([\w-]+)\/s3\//.exec(auth)?.[1] ?? null;
    seen.puts.push({ region, bytes: body.length, token: req.headers['x-amz-security-token'] });
    if (region !== REAL_REGION) {
      // Verbatim shape of the refusal S3 sends.
      res.writeHead(400, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>AuthorizationHeaderMalformed</Code><Message>The authorization header is malformed; the region '${region}' is wrong; expecting '${REAL_REGION}'</Message><Region>${REAL_REGION}</Region></Error>`);
      return;
    }
    res.writeHead(200).end();
    return;
  }

  res.writeHead(404).end();
});

await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
const fakePort = fake.address().port;

// The gateway under test, pointed at the stand-in.
const gatewayPort = 8799;
const gateway = spawn('node', [path.resolve(import.meta.dirname, '../scripts/proxy.mjs')], {
  env: { ...process.env, PROXY_PORT: String(gatewayPort), TRIPO_S3_REGION: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
gateway.stdout.on('data', (d) => logs.push(d.toString()));
await new Promise((resolve) => setTimeout(resolve, 900));

try {
  const response = await fetch(`http://localhost:${gatewayPort}/tripo/model-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tripo-key' },
    body: JSON.stringify({
      name: 'hero.fbx',
      baseUrl: `http://127.0.0.1:${fakePort}/v2/openapi`,
      dataUrl: 'data:application/octet-stream;base64,S2F5ZGFyYSBGQlggQmluYXJ5',
    }),
  });
  const payload = await response.json();

  check('the upload succeeds despite the region refusal', response.status, 200);
  check('it asks Tripo for an fbx ticket', seen.sts.at(-1), { format: 'fbx' });
  check('it tried us-east-1 first, then the region S3 named',
    seen.puts.map((p) => p.region), ['us-east-1', REAL_REGION]);
  check('the temporary session token was sent both times',
    seen.puts.every((p) => p.token === 'session-test'), true);
  check('the file bytes went up, not an empty body', seen.puts.at(-1).bytes > 0, true);
  check('it returns the object reference import_model needs',
    payload.file, { type: 'fbx', object: { bucket: 'tripo-bucket', key: 'uploads/hero.fbx' } });
  check('it tells you how to skip the wasted attempt',
    logs.join('').includes(`TRIPO_S3_REGION=${REAL_REGION}`), true);

  // Once learned, the region is reused - no second wasted attempt.
  seen.puts.length = 0;
  const again = await fetch(`http://localhost:${gatewayPort}/tripo/model-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tripo-key' },
    body: JSON.stringify({
      name: 'hero2.fbx',
      baseUrl: `http://127.0.0.1:${fakePort}/v2/openapi`,
      dataUrl: 'data:application/octet-stream;base64,S2F5ZGFyYSBGQlggQmluYXJ5',
    }),
  });
  check('a second upload succeeds', again.status, 200);
  check('and goes straight to the right region', seen.puts.map((p) => p.region), [REAL_REGION]);
} finally {
  gateway.kill();
  fake.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
