// Credentials live in this browser's localStorage and nowhere else: they are
// never written into a saved/exported graph, and never sent anywhere except the
// base URL of the node that uses them.

const STORAGE_KEY = 'nodespace.credentials.v1';

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.warn('could not persist credentials', err);
    return false;
  }
}

export function createKeystore() {
  let cache = read();
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn(list()));

  function list() {
    return cache.map(({ id, label, provider }) => ({ id, label, provider }));
  }

  function get(id) {
    return cache.find((c) => c.id === id)?.value ?? '';
  }

  function require(id, what = 'API key') {
    const value = get(id);
    if (!value) {
      throw new Error(`No ${what} selected. Open "Keys" in the toolbar and add one.`);
    }
    return value;
  }

  function save({ id, label, value, provider = 'openrouter' }) {
    const key = id || `cred_${Math.random().toString(36).slice(2, 9)}`;
    const existing = cache.findIndex((c) => c.id === key);
    const record = { id: key, label: label || 'Untitled key', value: value ?? '', provider };
    if (existing >= 0) cache[existing] = record;
    else cache.push(record);
    write(cache);
    notify();
    return record.id;
  }

  function remove(id) {
    cache = cache.filter((c) => c.id !== id);
    write(cache);
    notify();
  }

  function defaultFor(provider) {
    return cache.find((c) => c.provider === provider)?.id ?? cache[0]?.id ?? '';
  }

  function mask(id) {
    const value = get(id);
    if (!value) return '';
    return value.length <= 12 ? '*'.repeat(value.length) : `${value.slice(0, 8)}...${value.slice(-4)}`;
  }

  return {
    list,
    get,
    require,
    save,
    remove,
    defaultFor,
    mask,
    subscribe(fn) {
      listeners.add(fn);
      fn(list());
      return () => listeners.delete(fn);
    },
  };
}
