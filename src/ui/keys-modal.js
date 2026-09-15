// Credential manager. Values are stored by the keystore in localStorage only.

import { clear, h } from '../util/dom.js';

export function createKeysModal(container, { keystore }) {
  const rows = h('div', { class: 'key-rows' });
  const labelInput = h('input', { class: 'field-input', type: 'text', placeholder: 'Label (e.g. OpenRouter personal)' });
  const valueInput = h('input', { class: 'field-input', type: 'password', placeholder: 'sk-or-v1-...' });
  const providerInput = h(
    'select',
    { class: 'field-input' },
    [
      h('option', { value: 'openrouter' }, 'OpenRouter'),
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
              if (!valueInput.value.trim()) {
                status.textContent = 'Paste a key value first.';
                return;
              }
              keystore.save({
                label: labelInput.value.trim() || 'OpenRouter key',
                value: valueInput.value.trim(),
                provider: providerInput.value,
              });
              labelInput.value = '';
              valueInput.value = '';
              status.textContent = 'Saved.';
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
      rows.append(
        h('div', { class: 'key-row' }, [
          h('div', {}, [
            h('div', { class: 'key-label' }, cred.label),
            h('div', { class: 'key-mask' }, `${cred.provider} - ${keystore.mask(cred.id)}`),
          ]),
          h('button', { class: 'mini danger', type: 'button', onclick: () => keystore.remove(cred.id) }, 'Remove'),
        ]),
      );
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
