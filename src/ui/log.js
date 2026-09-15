// Run log drawer.

import { h } from '../util/dom.js';

export function createLog(root) {
  const list = h('div', { class: 'log-list' });
  const count = h('span', { class: 'log-count' });
  const body = h('div', { class: 'log-body' }, [list]);
  const toggle = h(
    'button',
    {
      class: 'log-toggle',
      type: 'button',
      onclick: () => {
        const open = root.classList.toggle('open');
        toggle.textContent = open ? 'Log ▾' : 'Log ▴';
      },
    },
    'Log ▴',
  );
  root.append(h('div', { class: 'log-head' }, [toggle, count]), body);

  let total = 0;

  function log(message, level = 'info', node = null) {
    total += 1;
    count.textContent = `${total}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    list.prepend(
      h('div', { class: `log-line ${level}` }, [
        h('span', { class: 'log-time' }, time),
        node ? h('span', { class: 'log-node' }, node.type) : null,
        h('span', { class: 'log-msg' }, String(message)),
      ]),
    );
    while (list.childElementCount > 300) list.lastElementChild.remove();
    if (level === 'error' || level === 'warn') root.classList.add('open');
  }

  return { log };
}
