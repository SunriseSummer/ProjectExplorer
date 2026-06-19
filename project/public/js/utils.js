export const $ = (id) => document.getElementById(id);

export function escapeHTML(value) {
  return String(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

export function escapeAttr(value) {
  return String(value).replace(/[&"']/g, (char) => ({ '&': '&amp;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

export function countFiles(node) {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((sum, child) => sum + countFiles(child), 0);
}
