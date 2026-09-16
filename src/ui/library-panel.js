// Browse what has been saved to my-work: thumbnails, notes, tags, search, and a
// way to pull something back onto the canvas.

import { clear, h } from '../util/dom.js';
import { fileUrl, listLibrary, removeFromLibrary, updateMeta } from '../providers/library.js';

const KIND_LABEL = { models: 'Model', videos: 'Video', images: 'Image', graphs: 'Graph' };

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function thumbnail(item) {
  const src = fileUrl(item.rel);
  if (item.kind === 'images') return h('img', { class: 'lib-thumb', src, alt: item.meta?.title ?? item.name });
  if (item.kind === 'videos') return h('video', { class: 'lib-thumb', src, muted: true, preload: 'metadata' });
  return h('div', { class: 'lib-thumb placeholder' }, item.kind === 'models' ? '3D' : '{ }');
}

export function createLibraryPanel(root, { onInsert, log }) {
  const search = h('input', { class: 'lib-search', type: 'search', placeholder: 'Search titles, tags, notes...' });
  const list = h('div', { class: 'lib-list' });
  const status = h('div', { class: 'lib-status' });
  const refresh = h('button', { class: 'mini', type: 'button', title: 'Reload from disk' }, '↻');
  const filters = h('div', { class: 'lib-filters' });

  root.append(
    h('div', { class: 'lib-head' }, [search, refresh]),
    filters,
    status,
    list,
  );

  let items = [];
  let kindFilter = 'all';

  function matches(item) {
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    const needle = search.value.trim().toLowerCase();
    if (!needle) return true;
    const hay = [item.name, item.meta?.title, item.meta?.notes, ...(item.meta?.tags ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(needle);
  }

  function renderFilters() {
    clear(filters);
    const kinds = ['all', ...new Set(items.map((i) => i.kind))];
    for (const kind of kinds) {
      filters.append(h(
        'button',
        {
          class: `lib-chip${kind === kindFilter ? ' active' : ''}`,
          type: 'button',
          onclick: () => {
            kindFilter = kind;
            render();
          },
        },
        kind === 'all' ? 'All' : KIND_LABEL[kind] ?? kind,
      ));
    }
  }

  function renderItem(item) {
    const notes = h('textarea', {
      class: 'lib-notes',
      rows: 2,
      placeholder: 'notes...',
      onchange: async (e) => {
        try {
          await updateMeta(item.rel, { notes: e.target.value });
          item.meta.notes = e.target.value;
          log(`notes saved for ${item.name}`);
        } catch (err) {
          log(`could not save notes: ${err.message}`, 'error');
        }
      },
    });
    notes.value = item.meta?.notes ?? '';

    const tags = h('input', {
      class: 'lib-tags',
      type: 'text',
      placeholder: 'tags, comma separated',
      onchange: async (e) => {
        const next = e.target.value.split(',').map((t) => t.trim()).filter(Boolean);
        try {
          await updateMeta(item.rel, { tags: next });
          item.meta.tags = next;
          renderFilters();
          log(`tags saved for ${item.name}`);
        } catch (err) {
          log(`could not save tags: ${err.message}`, 'error');
        }
      },
    });
    tags.value = (item.meta?.tags ?? []).join(', ');

    return h('div', { class: 'lib-item', dataset: { kind: item.kind } }, [
      h('div', { class: 'lib-row' }, [
        thumbnail(item),
        h('div', { class: 'lib-meta' }, [
          h('div', { class: 'lib-title', title: item.rel }, item.meta?.title || item.name),
          h('div', { class: 'lib-sub' }, `${KIND_LABEL[item.kind] ?? item.kind} - ${formatBytes(item.bytes)} - ${new Date(item.modified).toLocaleDateString()}`),
        ]),
      ]),
      tags,
      notes,
      h('div', { class: 'lib-actions' }, [
        h('button', { class: 'mini', type: 'button', onclick: () => onInsert(item) }, 'Add to canvas'),
        h('a', { class: 'mini', href: fileUrl(item.rel), target: '_blank', rel: 'noreferrer' }, 'Open'),
        h('button', {
          class: 'mini danger',
          type: 'button',
          onclick: async () => {
            if (!confirm(`Delete ${item.name} from my-work? This removes the file from disk.`)) return;
            try {
              await removeFromLibrary(item.rel);
              log(`deleted ${item.rel}`);
              load();
            } catch (err) {
              log(`could not delete: ${err.message}`, 'error');
            }
          },
        }, 'Delete'),
      ]),
    ]);
  }

  function render() {
    renderFilters();
    clear(list);
    const shown = items.filter(matches);
    if (!items.length) {
      list.append(h('div', { class: 'lib-empty' }, 'Nothing saved yet. Wire a "Save to Library" node after any result.'));
      return;
    }
    if (!shown.length) {
      list.append(h('div', { class: 'lib-empty' }, 'No matches.'));
      return;
    }
    for (const item of shown) list.append(renderItem(item));
  }

  async function load() {
    status.textContent = 'reading my-work...';
    try {
      const payload = await listLibrary();
      items = payload.items ?? [];
      status.textContent = `${items.length} item${items.length === 1 ? '' : 's'} in my-work`;
      status.title = payload.root ?? '';
    } catch (err) {
      items = [];
      status.textContent = err.message;
    }
    render();
  }

  search.addEventListener('input', render);
  refresh.addEventListener('click', load);

  return { load, render };
}
