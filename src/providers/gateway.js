// The local gateway (scripts/proxy.mjs). Tripo and Runway calls go through it
// because neither API can be called from a browser directly.

export const DEFAULT_GATEWAY = 'http://localhost:8787';
const STORAGE_KEY = 'nodespace.gateway';

// Where the gateway actually is. Normally the default, but remembered if it was
// moved (a different port, or a machine on the LAN).
let current = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_GATEWAY;
  } catch {
    return DEFAULT_GATEWAY;
  }
})();

export function getGateway() {
  return current;
}

export function setGateway(origin) {
  current = (origin || DEFAULT_GATEWAY).replace(/\/+$/, '');
  try {
    if (current === DEFAULT_GATEWAY) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, current);
  } catch {
    /* private browsing: keep it for this session only */
  }
  return current;
}

export function gatewayOrigin(baseUrl) {
  try {
    return new URL(baseUrl || current).origin;
  } catch {
    return current;
  }
}

export async function checkGateway(origin = current, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin.replace(/\/+$/, '')}/health`, { signal: controller.signal });
    if (!response.ok) return { up: false };
    const payload = await response.json();
    return { up: payload?.status === 'ok', providers: payload?.providers ?? [], keysFromEnv: payload?.keysFromEnv ?? {} };
  } catch {
    return { up: false };
  } finally {
    clearTimeout(timer);
  }
}
