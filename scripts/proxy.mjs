#!/usr/bin/env node
// Optional local proxy. Two reasons to use it:
//   1. the browser blocks the direct call as cross-origin (CORS), or
//   2. you would rather the key live in a server env var than in localStorage.
//
//   OPENROUTER_API_KEY=sk-or-v1-... node scripts/proxy.mjs
//   then set a node's Base URL to http://localhost:8787/api/v1
//
// Requests are forwarded verbatim to https://openrouter.ai. If the incoming
// request has no Authorization header, OPENROUTER_API_KEY is injected.

import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT ?? 8787);
const UPSTREAM = process.env.OPENROUTER_UPSTREAM ?? 'https://openrouter.ai';
const API_KEY = process.env.OPENROUTER_API_KEY ?? '';
const ALLOW_ORIGIN = process.env.PROXY_ALLOW_ORIGIN ?? '*';

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, HTTP-Referer, X-Title',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const target = new URL(req.url, UPSTREAM);
  const headers = {
    'Content-Type': req.headers['content-type'] ?? 'application/json',
    Authorization: req.headers.authorization || (API_KEY ? `Bearer ${API_KEY}` : ''),
    'HTTP-Referer': req.headers['http-referer'] ?? 'http://localhost',
    'X-Title': req.headers['x-title'] ?? 'Node Space',
  };
  if (!headers.Authorization) delete headers.Authorization;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      ...cors,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(text);
    console.log(`${req.method} ${target.pathname} -> ${upstream.status}`);
  } catch (err) {
    res.writeHead(502, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `proxy: ${err.message}` } }));
    console.error(`${req.method} ${target.pathname} -> proxy error`, err.message);
  }
});

server.listen(PORT, () => {
  console.log(`OpenRouter proxy on http://localhost:${PORT}  ->  ${UPSTREAM}`);
  console.log(`Set a node's Base URL to http://localhost:${PORT}/api/v1`);
  if (!API_KEY) console.log('No OPENROUTER_API_KEY set - the browser must send Authorization itself.');
});
