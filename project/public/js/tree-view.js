import { kindMeta, kindOf } from './meta.js';
import { State } from './state.js';
import { $, escapeAttr, escapeHTML, formatSize } from './utils.js';

let onSelectPath = () => {};

export function renderTree(selectPath) {
  onSelectPath = selectPath;
  State.rowByPath.clear();
  State.nodeByPath.clear();
  const tree = $('tree');
  tree.innerHTML = '';
  tree.appendChild(buildNode(State.tree, 0, true));
}

function buildNode(node, depth, openByDefault) {
  State.nodeByPath.set(node.path, node);
  const wrap = document.createElement('div');
  wrap.className = 'node';
  const row = document.createElement('div');
  row.className = 'row';
  row.style.paddingLeft = `${8 + depth * 14}px`;
  State.rowByPath.set(node.path, row);

  const isDir = node.type === 'dir';
  const kind = kindOf(node);
  const [, color, icon] = kindMeta(kind);
  const tw = document.createElement('span');
  tw.className = `tw${isDir && node.children?.length ? '' : ' leaf'}`;
  tw.textContent = '▸';
  const ic = document.createElement('span');
  ic.className = `ic ${kind}`;
  ic.style.color = color;
  ic.textContent = icon;
  const name = document.createElement('span');
  name.className = 'nm';
  name.textContent = node.path === '' ? State.project : node.name;
  row.append(tw, ic, name);

  if (!isDir && node.size != null) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = formatSize(node.size);
    row.appendChild(badge);
  }

  wrap.appendChild(row);
  let childBox = null;
  if (isDir && node.children?.length) {
    childBox = document.createElement('div');
    childBox.className = 'children';
    childBox.style.display = openByDefault ? 'block' : 'none';
    if (openByDefault) tw.classList.add('open');
    node.children.forEach((child) => childBox.appendChild(buildNode(child, depth + 1, false)));
    wrap.appendChild(childBox);
  }

  row.addEventListener('click', () => {
    if (childBox) {
      const willOpen = childBox.style.display === 'none';
      childBox.style.display = willOpen ? 'block' : 'none';
      tw.classList.toggle('open', willOpen);
    }
    onSelectPath(node.path);
  });
  return wrap;
}

export function setActiveRow(path) {
  document.querySelectorAll('.row.active').forEach((row) => row.classList.remove('active'));
  const row = State.rowByPath.get(path);
  if (!row) return;
  row.classList.add('active');
  row.scrollIntoView({ block: 'nearest' });
}

export function expandTo(path) {
  const parts = path ? path.split('/') : [];
  let acc = '';
  for (let index = 0; index < parts.length; index += 1) {
    acc = index === 0 ? parts[0] : `${acc}/${parts[index]}`;
    const row = State.rowByPath.get(acc);
    const box = row?.parentElement?.querySelector(':scope > .children');
    if (box) {
      box.style.display = 'block';
      row.querySelector('.tw')?.classList.add('open');
    }
  }
}

export function renderCrumbs(path, selectPath) {
  const parts = path ? path.split('/') : [];
  const items = [{ label: State.project, path: '' }];
  let acc = '';
  parts.forEach((part, index) => {
    acc = index === 0 ? part : `${acc}/${part}`;
    items.push({ label: part, path: acc });
  });
  $('crumbs').innerHTML = items.map((item, index) => {
    const current = index === items.length - 1;
    return `<span class="cb${current ? ' cur' : ''}" data-p="${escapeAttr(item.path)}">${escapeHTML(item.label)}</span>${current ? '' : '<span class="sep">/</span>'}`;
  }).join('');
  $('crumbs').querySelectorAll('.cb').forEach((el) => {
    el.addEventListener('click', () => {
      expandTo(el.dataset.p);
      selectPath(el.dataset.p);
    });
  });
}
