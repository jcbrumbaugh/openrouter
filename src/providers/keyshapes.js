// Providers issue keys with recognisable prefixes. Checking them catches the
// commonest mix-up - a key from one service selected on another service's node -
// before a request is spent finding out.

export const KEY_SHAPES = [
  { provider: 'openrouter', prefix: 'sk-or-', label: 'OpenRouter' },
  { provider: 'runway', prefix: 'key_', label: 'Runway' },
  { provider: 'tripo', prefix: 'tsk_', label: 'Tripo' },
  { provider: 'openai', prefix: 'sk-', label: 'OpenAI' }, // after sk-or-, which is more specific
];

export function guessProvider(value) {
  const key = String(value ?? '').trim();
  return KEY_SHAPES.find((shape) => key.startsWith(shape.prefix)) ?? null;
}

export function labelFor(provider) {
  return KEY_SHAPES.find((shape) => shape.provider === provider)?.label ?? provider;
}

// Returns the key, or throws saying exactly what is wrong with the one chosen.
export function requireKeyFor(keystore, credentialId, provider, { nodeHint = '' } = {}) {
  const key = keystore.require(credentialId, `${labelFor(provider)} key`);
  const looksLike = guessProvider(key);

  if (looksLike && looksLike.provider !== provider) {
    throw new Error(
      `The key selected here looks like a ${looksLike.label} key (it starts with "${looksLike.prefix}"), but this node calls ${labelFor(provider)}.` +
        (nodeHint ? ` ${nodeHint}` : ' Pick the right key under Keys, or use the node for that service.'),
    );
  }

  const stored = keystore.list().find((c) => c.id === credentialId)?.provider;
  if (stored && stored !== provider && stored !== 'other') {
    throw new Error(
      `That key is saved as a ${labelFor(stored)} key but this node calls ${labelFor(provider)}.` +
        (nodeHint ? ` ${nodeHint}` : ''),
    );
  }
  return key;
}
