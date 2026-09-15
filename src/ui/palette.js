// Left sidebar palette plus the double-click quick-add popover.

import { clear, h } from '../util/dom.js';

function paletteItem(def, onPick) {
  return h(
    'button',
    {
      class: 'palette-item',
      type: 'button',
      style: { '--accent': def.accent ?? '#9aa3b2' },
      title: def.hint ?? def.title,
      onclick: () => onPick(def),
    },
    [h('span', { class: 'palette-dot' }), h('span', {}, def.title)],
  );
}

export function createPalette(root, { registry, onPick }) {
  function render() {
    clear(root);
    for (const [category, defs] of registry.byCategory()) {
      root.append(
        h('div', { class: 'palette-group' }, [
          h('div', { class: 'palette-heading' }, category),
          ...defs.map((def) => paletteItem(def, onPick)),
        ]),
      );
    }
  }
  render();
  return { render };
}

export function createQuickAdd(container, { registry, onPick }) {
  const search = h('input', { class: 'quick-search', type: 'text', placeholder: 'Search nodes...' });
  const list = h('div', { class: 'quick-list' });
  const panel = h('div', { class: 'quick-add hidden' }, [search, list]);
  container.append(panel);
  let position = { x: 0, y: 0 };

  function renderList() {
    const needle = search.value.trim().toLowerCase();
    clear(list);
    const matches = registry
      .all()
      .filter((def) => !needle || `${def.title} ${def.category} ${def.type}`.toLowerCase().includes(needle));
    if (!matches.length) {
      list.append(h('div', { class: 'quick-empty' }, 'no matches'));
      return;
    }
    for (const def of matches) {
      list.append(
        h(
          'button',
          {
            class: 'palette-item',
            type: 'button',
            style: { '--accent': def.accent ?? '#9aa3b2' },
            onclick: () => {
              close();
              onPick(def, position);
            },
          },
          [h('span', { class: 'palette-dot' }), h('span', {}, def.title), h('span', { class: 'quick-cat' }, def.category)],
        ),
      );
    }
  }

  function open(graphPoint, screenPoint) {
    position = graphPoint;
    panel.style.left = `${screenPoint.clientX}px`;
    panel.style.top = `${screenPoint.clientY}px`;
    panel.classList.remove('hidden');
    search.value = '';
    renderList();
    search.focus();
  }

  function close() {
    panel.classList.add('hidden');
  }

  search.addEventListener('input', renderList);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') list.querySelector('.palette-item')?.click();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.contains(event.target)) close();
  });

  return { open, close };
}
