import { highlightCode } from './content-view.js';
import { $ } from './utils.js';

export const Theme = {
  current: localStorage.getItem('project-explorer-theme') || 'light',
  apply() {
    document.documentElement.dataset.theme = this.current;
    $('btn-theme').textContent = this.current === 'dark' ? '☀' : '☾';
    const theme = $('hljs-theme');
    if (theme) {
      theme.href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${this.current === 'dark' ? 'github-dark' : 'github'}.min.css`;
    }
    localStorage.setItem('project-explorer-theme', this.current);
  },
  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark';
    this.apply();
    highlightCode();
  },
};

export function initTheme() {
  $('btn-theme').addEventListener('click', () => Theme.toggle());
  Theme.apply();
}
