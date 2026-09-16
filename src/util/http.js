// Shared HTTP manners for provider clients: readable errors, and retries for
// the requests where retrying is safe.

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

// Gateways answer with HTML error pages. Dumping that markup at someone is
// useless, so pull the headline out of it.
export function cleanDetail(text, fallback = '') {
  if (typeof text !== 'string' || !text.trim()) return fallback;
  const looksLikeHtml = /^\s*<(!doctype|html|head|body|center)/i.test(text) || /<\/html>/i.test(text);
  if (looksLikeHtml) {
    const title = /<title[^>]*>([^<]+)<\/title>/i.exec(text)?.[1];
    const heading = /<h1[^>]*>([^<]+)<\/h1>/i.exec(text)?.[1];
    const headline = (title || heading || '').trim();
    return headline ? `${headline} (the provider's own server returned an error page)` : fallback;
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}...` : flat;
}

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(status);
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// Retries a request that is safe to repeat - a status poll, a read. Never wrap
// anything that creates work: a repeated POST can mean two jobs and two
// charges. Backs off 2s, 4s, 8s.
export async function withRetry(fn, { attempts = 3, signal, onRetry } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      const retryable = err?.status ? isRetryableStatus(err.status) : true; // network failures have no status
      if (!retryable || attempt === attempts) throw err;
      lastError = err;
      const delay = 2000 * 2 ** (attempt - 1);
      onRetry?.(err, attempt, delay);
      await wait(delay, signal);
    }
  }
  throw lastError;
}
