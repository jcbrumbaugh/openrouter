// Minimal pub/sub used by the store and engine.

export function emitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    emit(event, payload) {
      for (const fn of listeners.get(event) ?? []) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`listener for "${event}" threw`, err);
        }
      }
      for (const fn of listeners.get('*') ?? []) {
        try {
          fn({ event, payload });
        } catch (err) {
          console.error('wildcard listener threw', err);
        }
      }
    },
  };
}
