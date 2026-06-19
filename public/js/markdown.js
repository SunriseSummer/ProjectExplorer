import { escapeAttr, escapeHTML } from './utils.js';

export function initMarkdown() {
  if (!window.marked) return;
  try {
    marked.setOptions({ breaks: false, gfm: true });
    if (window.hljs) {
      marked.setOptions({
        highlight(code, lang) {
          if (lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(code, { language: lang }).value;
            } catch {}
          }
          return code;
        },
      });
    }
  } catch {}
}

export function renderMarkdown(text) {
  if (window.marked) {
    try {
      return marked.parse(escapeHTML(text));
    } catch {}
  }
  let html = escapeHTML(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="${lang ? `language-${escapeAttr(lang)}` : ''}">${escapeHTML(code.trim())}</code></pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = `<p>${html.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
  return html.replace(/<p><\/p>/g, '');
}
