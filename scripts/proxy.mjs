#!/usr/bin/env node
// Local API gateway for providers that cannot be called from a browser.
//
//   node scripts/proxy.mjs
//
// OpenRouter serves CORS headers, so the page can call it directly. Tripo and
// Runway do not - Runway's own SDK refuses to run in a browser at all - so the
// page talks to this instead, and this talks to them. It also lets the keys
// live in a server env var rather than in browser storage.
//
//   http://localhost:8787/openrouter/... -> https://openrouter.ai/...
//   http://localhost:8787/tripo/...      -> https://api.tripo3d.ai/...
//   http://localhost:8787/runway/...     -> https://api.dev.runwayml.com/...
//   http://localhost:8787/api/v1/...     -> https://openrouter.ai/api/v1/...  (legacy)
//
// Bodies are forwarded byte for byte, so multipart uploads pass through intact.

import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const ALLOW_ORIGIN = process.env.PROXY_ALLOW_ORIGIN ?? '*';

const PROVIDERS = {
  openrouter: {
    upstream: process.env.OPENROUTER_UPSTREAM ?? 'https://openrouter.ai',
    key: () => process.env.OPENROUTER_API_KEY,
    headers: () => ({ 'HTTP-Referer': 'http://localhost', 'X-Title': 'Node Space' }),
  },
  tripo: {
    upstream: process.env.TRIPO_UPSTREAM ?? 'https://api.tripo3d.ai',
    key: () => process.env.TRIPO_API_KEY,
    headers: () => ({}),
  },
  runway: {
    upstream: process.env.RUNWAY_UPSTREAM ?? 'https://api.dev.runwayml.com',
    key: () => process.env.RUNWAYML_API_SECRET ?? process.env.RUNWAY_API_KEY,
    // Runway pins behaviour to a dated API version; without it every call 400s.
    headers: () => ({ 'X-Runway-Version': process.env.RUNWAY_API_VERSION ?? '2024-11-06' }),
  },
};

const CORS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, HTTP-Referer, X-Title, X-Runway-Version',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function route(pathname) {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return null;
  const [, head, rest = '/'] = match;
  if (PROVIDERS[head]) return { provider: PROVIDERS[head], name: head, path: rest };
  // Legacy shape: everything else is assumed to be OpenRouter.
  if (head === 'api') return { provider: PROVIDERS.openrouter, name: 'openrouter', path: pathname };
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const target = route(url.pathname);
  if (!target) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Unknown provider prefix. Use one of: ${Object.keys(PROVIDERS).join(', ')}.` } }));
    return;
  }

  const upstreamUrl = new URL(target.path + url.search, target.provider.upstream);
  const headers = { ...target.provider.headers() };
  // The browser's own Authorization wins; the env var is the fallback.
  const envKey = target.provider.key();
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  else if (envKey) headers.Authorization = `Bearer ${envKey}`;
  // Pass the content type through verbatim so multipart boundaries survive.
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      ...CORS,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(buffer);
    console.log(`${req.method} ${target.name}${target.path} -> ${upstream.status}`);
  } catch (err) {
    res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `proxy could not reach ${target.name}: ${err.message}` } }));
    console.error(`${req.method} ${target.name}${target.path} -> ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  API gateway on http://localhost:${PORT}`);
  for (const [name, provider] of Object.entries(PROVIDERS)) {
    const has = provider.key() ? 'key from env' : 'key from the browser';
    console.log(`    /${name.padEnd(11)} -> ${provider.upstream.padEnd(32)} (${has})`);
  }
  console.log('\n  Press Control-C to stop.\n');
});
