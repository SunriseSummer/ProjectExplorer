import { Api } from './api.js';
import { bindChatEvents, renderChatSection, resetChatState, restoreOrRenderAskPanel } from './chat.js';
import { EXT_LABEL, HLJS_LANG, kindMeta, kindOf } from './meta.js';
import { State } from './state.js';
import { expandTo, renderCrumbs, setActiveRow } from './tree-view.js';
import { $, escapeAttr, escapeHTML, formatSize, truncate } from './utils.js';

let selectPathRef = () => {};

export function setSelectHandler(selectPath) {
  selectPathRef = selectPath;
}

export async function selectPath(path) {
  State.activePath = path;
  setActiveRow(path);
  renderCrumbs(path, selectPathRef);

  const node = State.nodeByPath.get(path);
  if (!node) return;
  resetChatState(path, node.type);

  if (node.type === 'dir') await renderDir(node);
  else await renderFile(node);
}

async function renderDir(node) {
  let html = '<div class="view">';
  if (node.children?.length) html += renderChildrenList(node);
  html += `${renderChatSection(node)}</div>`;
  $('content').innerHTML = html;
  bindChatEvents(node);
  bindChildClicks();
  await restoreOrRenderAskPanel(node);
}

async function renderFile(node) {
  $('content').innerHTML = `<div class="view">${renderChatSection(node)}<div class="card code-card" id="code-preview-card"><div class="loading">正在读取文件...</div></div></div>`;
  bindChatEvents(node);
  await restoreOrRenderAskPanel(node);
  const data = await Api.file(node.path).catch((error) => ({ error: error.message }));
  const card = $('code-preview-card');
  if (card) card.outerHTML = filePreviewHtml(node, data);
  highlightCode();
}

function renderChildrenList(node) {
  const children = node.children || [];
  const items = children.map((child) => {
    const [label, color, icon] = kindMeta(kindOf(child));
    const description = child.type === 'dir' ? '目录' : EXT_LABEL[child.ext] || (child.ext ? `${child.ext.slice(1).toUpperCase()} 文件` : '文件');
    const meta = child.type === 'file' ? `${formatSize(child.size || 0)} · ${label}` : `${child.children?.length || 0} 项`;
    return `<div class="cl-item" data-p="${escapeAttr(child.path)}">
      <span class="ci" style="color:${color}">${icon}</span>
      <div style="min-width:0">
        <div class="ct">${escapeHTML(child.name)}</div>
        <div class="cd">${escapeHTML(truncate(description, 90))}</div>
        <div class="cmeta">${escapeHTML(meta)}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="card"><div class="hd"><span class="t" style="font-size:14px">目录内容</span><span class="path">${children.length} 项</span></div><div class="children-list">${items}</div></div>`;
}

function bindChildClicks() {
  document.querySelectorAll('#content .cl-item').forEach((item) => {
    item.addEventListener('click', () => {
      expandTo(item.dataset.p);
      selectPathRef(item.dataset.p);
      $('content').scrollTo({ top: 0 });
    });
  });
}

function filePreviewHtml(node, data) {
  if (!data || data.error) return `<div class="card"><div class="notice">无法读取：${escapeHTML(data?.error || '未知错误')}</div></div>`;
  if (data.kind === 'image') {
    return `<div class="card code-card"><div class="code-bar"><span class="fn">${escapeHTML(node.name)}</span><span class="meta">${formatSize(data.size)}</span></div><div class="img-prev"><img src="/api/raw?path=${encodeURIComponent(node.path)}" alt="${escapeAttr(node.name)}"></div></div>`;
  }
  if (data.kind === 'binary') {
    return `<div class="card"><div class="notice">二进制文件（${escapeHTML(node.ext || '')} · ${formatSize(data.size)}），不提供文本预览。</div></div>`;
  }
  const lines = data.content.split(/\r\n|\r|\n/);
  const gutter = lines.map((_, index) => index + 1).join('\n');
  const lang = HLJS_LANG[node.ext] || '';
  return `<div class="card code-card">
    <div class="code-bar"><span class="fn">${escapeHTML(node.name)}</span><span class="meta">${lines.length} 行 · ${formatSize(data.size)}</span></div>
    <div class="code-wrap"><div class="gutter">${gutter}</div><pre class="code"><code class="${lang ? `language-${lang}` : 'nohighlight'}">${escapeHTML(data.content)}</code></pre></div>
    ${data.truncated ? '<div class="warn-bar">⚠ 文件较大，已截断显示前 600 KB</div>' : ''}
  </div>`;
}

export function highlightCode() {
  if (!window.hljs) return;
  document.querySelectorAll('#content pre code').forEach((el) => {
    try {
      window.hljs.highlightElement(el);
    } catch {}
  });
}
