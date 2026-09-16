// The local gateway (scripts/proxy.mjs). Tripo and Runway calls go through it
// because neither API can be called from a browser directly.

export const DEFAULT_GATEWAY = 'http://localhost:8787';

export function gatewayOrigin(baseUrl) {
  try {
    return new URL(baseUrl || DEFAULT_GATEWAY).origin;
  } catch {
    return DEFAULT_GATEWAY;
  }
}

export async function checkGateway(origin = DEFAULT_GATEWAY, timeoutMs = 2500) {
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
