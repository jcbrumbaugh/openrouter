// Node type registry. A node definition is plain data plus an async run().
//
//   run({ inputs, data, signal, keystore, log, setData, setStatus }) -> outputs
//
// Field kinds understood by the node card renderer:
//   text | textarea | number | select | checkbox | file | credential | model | info

export function createRegistry() {
  const types = new Map();
  return {
    register(def) {
      if (!def?.type) throw new Error('node definition needs a type');
      if (typeof def.run !== 'function') throw new Error(`${def.type} needs a run()`);
      types.set(def.type, def);
      return def;
    },
    get(type) {
      return types.get(type);
    },
    all() {
      return [...types.values()];
    },
    byCategory() {
      const groups = new Map();
      for (const def of types.values()) {
        const key = def.category ?? 'Other';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(def);
      }
      return groups;
    },
  };
}
