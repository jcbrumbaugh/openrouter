// Credential manager. Values are stored by the keystore in localStorage only.

import { clear, h } from '../util/dom.js';
import { keyInfo } from '../providers/openrouter.js';

// getBaseUrl lets Test follow whatever base URL the graph's OpenRouter nodes
// use, so testing through the local proxy works the same as testing direct.
export function createKeysModal(container, { keystore, getBaseUrl = () => '' }) {
  const rows = h('div', { class: 'key-rows' });
  const labelInput = h('input', { class: 'field-input', type: 'text', placeholder: 'Label (e.g. OpenRouter personal)' });
  const valueInput = h('input', { class: 'field-input', type: 'password', placeholder: 'sk-or-v1-...' });
  const providerInput = h(
    'select',
    { class: 'field-input' },
    [
      h('option', { value: 'openrouter' }, 'OpenRouter'),
      h('option', { value: 'openai' }, 'OpenAI'),
      h('option', { value: 'tripo' }, 'Tripo'),
      h('option', { value: 'runway' }, 'Runway'),
      h('option', { value: 'other' }, 'Other / custom API'),
    ],
  );
  const status = h('div', { class: 'modal-note' });

  const panel = h('div', { class: 'modal-panel' }, [
    h('div', { class: 'modal-head' }, [
      h('h2', {}, 'API keys'),
      h('button', { class: 'mini', type: 'button', onclick: () => close() }, 'Close'),
    ]),
    h(
      'p',
      { class: 'modal-note' },
      'Keys are saved in this browser only (localStorage). They are never written into a saved or exported graph. Treat any key you have pasted into a chat or committed to a repo as compromised and rotate it.',
    ),
    rows,
    h('div', { class: 'modal-form' }, [
      h('label', { class: 'field-label' }, 'Add a key'),
      labelInput,
      providerInput,
      valueInput,
      h('div', { class: 'field-row' }, [
        h(
          'button',
          {
            class: 'primary',
            type: 'button',
            onclick: () => {
              status.textContent = '';
              if (!valueInput.value.trim()) {
                status.textContent = 'Paste a key value first.';
                return;
              }
              const value = valueInput.value.trim();
              if (providerInput.value === 'openrouter' && !value.startsWith('sk-or-')) {
                status.textContent = 'Saved, but OpenRouter keys normally start with "sk-or-" - double-check you copied the whole thing.';
              }
              keystore.save({
                label: labelInput.value.trim() || `${providerInput.value} key`,
                value,
                provider: providerInput.value,
              });
              labelInput.value = '';
              valueInput.value = '';
              if (!status.textContent) status.textContent = 'Saved. Use Test to check it works.';
            },
          },
          'Save key',
        ),
      ]),
      status,
    ]),
  ]);

  const backdrop = h('div', { class: 'modal hidden', onpointerdown: (e) => {
    if (e.target === backdrop) close();
  } }, [panel]);
  container.append(backdrop);

  function renderRows(list) {
    clear(rows);
    if (!list.length) {
      rows.append(h('div', { class: 'modal-note' }, 'No keys yet.'));
      return;
    }
    for (const cred of list) {
      const verdict = h('div', { class: 'key-verdict' });
      rows.append(
        h('div', { class: 'key-row' }, [
          h('div', { class: 'key-info' }, [
            h('div', { class: 'key-label' }, cred.label),
            h('div', { class: 'key-mask' }, `${cred.provider} - ${keystore.mask(cred.id)}`),
            verdict,
          ]),
          h('div', { class: 'field-row' }, [
            h('button', { class: 'mini', type: 'button', onclick: (e) => testKey(cred, verdict, e.target) }, 'Test'),
            h('button', { class: 'mini danger', type: 'button', onclick: () => keystore.remove(cred.id) }, 'Remove'),
          ]),
        ]),
      );
    }
  }

  // Asks OpenRouter what this key is. Answers "is my key the problem?" without
  // spending credit or involving a model.
  async function testKey(cred, target, button) {
    if (cred.provider !== 'openrouter') {
      target.textContent = 'Test currently only checks OpenRouter keys.';
      target.className = 'key-verdict warn';
      return;
    }
    const label = button.textContent;
    button.textContent = 'Testing...';
    button.disabled = true;
    target.textContent = '';
    target.className = 'key-verdict';
    try {
      const payload = await keyInfo({ baseUrl: getBaseUrl(), apiKey: keystore.get(cred.id) });
      const data = payload?.data ?? payload ?? {};
      const bits = [];
      if (data.label) bits.push(String(data.label));
      if (typeof data.usage === 'number') bits.push(`used $${data.usage.toFixed(2)}`);
      if (typeof data.limit === 'number') bits.push(`limit $${data.limit}`);
      else if (data.limit === null) bits.push('no limit');
      target.textContent = bits.length ? `Working - ${bits.join(', ')}` : 'Working.';
      target.className = 'key-verdict ok';
    } catch (err) {
      target.textContent = /^401/.test(err.message)
        ? 'Rejected (401). This key is revoked or mistyped - copy a fresh one from openrouter.ai/settings/keys.'
        : err.message;
      target.className = 'key-verdict err';
    } finally {
      button.textContent = label;
      button.disabled = false;
    }
  }

  keystore.subscribe(renderRows);

  function open() {
    status.textContent = '';
    backdrop.classList.remove('hidden');
    labelInput.focus();
  }
  function close() {
    backdrop.classList.add('hidden');
  }

  return { open, close };
}
