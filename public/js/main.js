import { Api } from './api.js';
import { selectPath, setSelectHandler } from './content-view.js';
import { initMarkdown } from './markdown.js';
import { initSettings, Settings } from './settings.js';
import { State } from './state.js';
import { initTheme } from './theme.js';
import { renderTree } from './tree-view.js';
import { $, countFiles, escapeHTML } from './utils.js';

async function boot() {
  initMarkdown();
  initSettings();
  initTheme();

  try {
    const treeRes = await Api.tree();
    State.tree = treeRes.tree;
    State.project = treeRes.project;
    $('brand-sub').textContent = `用 AI 快速理解任意项目`;
    $('tree-count').textContent = `${countFiles(State.tree)} files`;
    $('proj-desc').textContent = `${treeRes.project} · 选择目录或文件开始`;

    setSelectHandler(selectPath);
    renderTree(selectPath);
    await selectPath('');
    await Settings.refreshFooter();
  } catch (error) {
    $('tree').innerHTML = `<div class="loading" style="color:var(--red)">加载失败：${escapeHTML(error.message)}</div>`;
  }
}

boot();
