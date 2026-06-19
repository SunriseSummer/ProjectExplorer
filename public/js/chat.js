import { Api, jsonOptions } from './api.js';
import { kindMeta, kindOf } from './meta.js';
import { renderMarkdown } from './markdown.js';
import { getPresets, resolvePrompt } from './presets.js';
import { ChatState } from './state.js';
import { $, escapeAttr, escapeHTML, truncate } from './utils.js';

const SEND_ICON = `<svg class="send-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4 20-7Z"></path><path d="M22 2 11 13"></path></svg>`;
const STOP_ICON = `<svg class="stop-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"></rect></svg>`;

const TOOL_COPY = {
  get_project_map: {
    title: '绘制项目地图',
    detail: (args) => `范围 ${prettyPath(args.path)} · 深度 ${args.maxDepth ?? 2}`,
  },
  find_important_files: {
    title: '筛选关键文件',
    detail: (args) => `范围 ${prettyPath(args.path)} · 最多 ${args.limit ?? 40} 个`,
  },
  list_directory: {
    title: '展开目录',
    detail: (args) => prettyPath(args.path),
  },
  get_file_outline: {
    title: '提取文件大纲',
    detail: (args) => args.path || '',
  },
  read_file_slice: {
    title: '精读代码片段',
    detail: (args) => `${args.path || ''}:${args.startLine ?? '?'}-${args.endLine ?? '?'}`,
  },
  read_file: {
    title: '读取文件',
    detail: (args) => args.path || '',
  },
  read_related_files: {
    title: '批量读取相关文件',
    detail: (args) => `${Array.isArray(args.paths) ? args.paths.length : 0} 个文件`,
  },
  search_code: {
    title: '搜索代码',
    detail: (args) => args.pattern || '',
  },
  search_code_context: {
    title: '搜索上下文',
    detail: (args) => `${args.pattern || ''} · ±${args.before ?? 3}/${args.after ?? 4} 行`,
  },
};

export function resetChatState(path, type) {
  if (ChatState.abortController) ChatState.abortController.abort();
  if (ChatState.streamTimer) clearTimeout(ChatState.streamTimer);
  closePresetPop();
  Object.assign(ChatState, {
    messages: [],
    abortController: null,
    currentPath: path,
    currentType: type,
    node: null,
    lastUserText: '',
    lastUserElement: null,
    streaming: false,
    streamElement: null,
    streamTimer: null,
    thinkingElement: null,
    analysisElement: null,
    buffer: '',
    displayed: '',
  });
}

export function renderChatSection(node) {
  const [, color, icon] = kindMeta(kindOf(node));
  const shownPath = node.path === '' ? '/' : `/${node.path}`;
  return `<section class="chat-section">
    <div class="chat-header">
      <span class="chat-path-icon" style="color:${color}">${icon}</span>
      <span class="chat-path-name">${escapeHTML(node.path === '' ? '项目根目录' : node.name)}</span>
      <span class="chat-path">${escapeHTML(shownPath)}</span>
      <button class="chat-reset-btn" id="chat-reset">重置对话</button>
    </div>
    <div class="chat-msgs" id="chat-msgs"></div>
    <div class="chat-input-wrap">
      <div class="chat-input-box" id="chat-input-box">
        <textarea class="chat-input" id="chat-input" rows="3" placeholder="向 AI 询问这个节点…（回车换行，点击纸飞机发送 / Ctrl+Enter）"></textarea>
        <div class="preset-pop" id="preset-pop" hidden></div>
        <div class="chat-input-actions">
          <button class="chat-tool-btn" id="chat-presets" title="预置问题" aria-label="预置问题">
            <svg class="matrix-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="9.25" y="3" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="15.5" y="3" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="3" y="9.25" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="15.5" y="9.25" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="3" y="15.5" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="9.25" y="15.5" width="5.5" height="5.5" rx="1.3"></rect>
              <rect x="15.5" y="15.5" width="5.5" height="5.5" rx="1.3"></rect>
            </svg>
          </button>
          <button class="chat-send" id="chat-send" title="发送（Ctrl/⌘+Enter）" aria-label="发送">${SEND_ICON}</button>
        </div>
      </div>
    </div>
  </section>`;
}

export function bindChatEvents(node) {
  ChatState.node = node;
  const input = $('chat-input');
  const sendBtn = $('chat-send');
  const presetBtn = $('chat-presets');
  if (!input || !sendBtn) return;
  input.disabled = false;
  sendBtn.disabled = false;
  if (presetBtn) presetBtn.disabled = false;
  sendBtn.onclick = () => (ChatState.streaming ? abortChat() : sendChatMessage());
  input.onkeydown = (event) => {
    // 回车换行；仅 Ctrl/⌘+Enter 才发送
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendChatMessage();
    }
  };
  input.oninput = () => autoGrowInput(input);
  $('chat-msgs').onclick = onChatMessagesClick;
  if (presetBtn) {
    presetBtn.onclick = (event) => {
      event.stopPropagation();
      togglePresetPop(node);
    };
  }
  $('chat-reset').onclick = () => {
    if (ChatState.streaming) return;
    if (confirm('确定重置对话？本节点的缓存会被清除。')) resetConversation(node);
  };
}

function autoGrowInput(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
}

export async function restoreOrRenderAskPanel(node) {
  const saved = await Api.analysis(ChatState.currentPath).then((data) => data.messages || []).catch(() => null);
  if (saved?.length) renderSavedMessages(saved);
  else renderEmptyState(node);
}

function renderEmptyState() {
  // 尚未开启对话：清空消息区（CSS 下会折叠为 0 高），只保留标题栏和输入框
  const host = $('chat-msgs');
  if (host) host.innerHTML = '';
}

function sendChatMessage() {
  if (ChatState.streaming) return;
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  closePresetPop();
  input.value = '';
  input.style.height = '';
  const host = $('chat-msgs');
  if (host?.querySelector('.chat-empty')) host.innerHTML = '';
  startChatStream(text);
}

function togglePresetPop(node) {
  const pop = $('preset-pop');
  if (!pop) return;
  if (!pop.hidden) {
    closePresetPop();
    return;
  }
  const items = getPresets(node).map((preset) => {
    const prompt = resolvePrompt(preset.prompt, node);
    return `<button class="preset-item" data-prompt="${escapeAttr(prompt)}" title="${escapeAttr(prompt)}">
      <span class="preset-item-icon">${preset.icon}</span>
      <span class="preset-item-label">${escapeHTML(preset.label)}</span>
    </button>`;
  }).join('');
  pop.innerHTML = `<div class="preset-pop-head">预置问题<span class="preset-pop-hint">点选后可二次编辑再发送</span></div><div class="preset-pop-list">${items}</div>`;
  pop.hidden = false;
  pop.querySelectorAll('.preset-item').forEach((item) => {
    item.addEventListener('click', () => {
      const input = $('chat-input');
      input.value = item.dataset.prompt;
      autoGrowInput(input);
      closePresetPop();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  });
  positionPresetPop();
  setTimeout(() => {
    document.addEventListener('click', onPresetOutsideClick);
    window.addEventListener('resize', closePresetPop);
    window.addEventListener('scroll', onPresetWindowScroll, true);
  }, 0);
}

// 用 fixed 定位浮层，escape 掉 .chat-section 的 overflow:hidden 裁剪；
// 浮层挂到 body 下，避免 .view 等带 transform 的祖先成为 fixed 的包含块导致错位；
// 再根据上下可用空间自动向上或向下展开，保证整列表都在视口内、顶部不被遮挡。
function positionPresetPop() {
  const pop = $('preset-pop');
  const box = $('chat-input-box');
  if (!pop || !box) return;
  if (pop.parentElement !== document.body) document.body.appendChild(pop);
  const r = box.getBoundingClientRect();
  const margin = 8;
  const spaceAbove = r.top;
  const spaceBelow = window.innerHeight - r.bottom;
  const openUp = spaceAbove >= spaceBelow;
  const space = (openUp ? spaceAbove : spaceBelow) - margin;
  pop.style.position = 'fixed';
  pop.style.left = 'auto';
  pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  pop.style.width = `${Math.min(360, r.width - 4)}px`;
  pop.style.maxHeight = `${Math.max(150, Math.min(340, space))}px`;
  if (openUp) {
    pop.style.top = 'auto';
    pop.style.bottom = `${window.innerHeight - r.top + margin}px`;
  } else {
    pop.style.bottom = 'auto';
    pop.style.top = `${r.bottom + margin}px`;
  }
}

function onPresetOutsideClick(event) {
  const pop = $('preset-pop');
  if (!pop || pop.hidden) return;
  if (event.target.closest('#preset-pop') || event.target.closest('#chat-presets')) return;
  closePresetPop();
}

function onPresetWindowScroll(event) {
  const pop = $('preset-pop');
  if (!pop || pop.hidden) return;
  if (event.target === pop || event.target.closest?.('#preset-pop')) return;
  closePresetPop();
}

function closePresetPop() {
  const pop = $('preset-pop');
  if (pop) {
    pop.hidden = true;
    pop.style.cssText = ''; // 清除 fixed 定位，下次打开重新测量
    const home = $('chat-input-box'); // 收回到输入框内，避免遗留在 body 造成重复
    if (home && pop.parentElement !== home) home.appendChild(pop);
  }
  document.removeEventListener('click', onPresetOutsideClick);
  window.removeEventListener('resize', closePresetPop);
  window.removeEventListener('scroll', onPresetWindowScroll, true);
}

async function startChatStream(firstMessage) {
  if (ChatState.abortController) ChatState.abortController.abort();
  Object.assign(ChatState, { streaming: true, buffer: '', displayed: '', abortController: new AbortController() });
  setStreamingUI(true);
  ChatState.lastUserText = firstMessage;
  ChatState.lastUserElement = addUserMessage(firstMessage, ChatState.messages.length);
  ChatState.messages.push({ role: 'user', content: firstMessage });
  ensureThinkingBar();

  let fullContent = '';
  let started = false;
  try {
    const response = await fetch('/api/chat', {
      ...jsonOptions({ path: ChatState.currentPath, type: ChatState.currentType, messages: ChatState.messages }),
      signal: ChatState.abortController.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });
      const lines = textBuffer.split('\n');
      textBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = JSON.parse(line.slice(6).trim());
        if (payload.type === 'tool_call') {
          removeAnalysisBar();
          addToolBar(payload.name, payload.args);
        }
        if (payload.type === 'tool_result') {
          updateLastToolBar(payload.summary, payload.ok !== false);
          ensureAnalysisBar();
        }
        if (payload.type === 'discard') {
          discardStreamElement();
          fullContent = '';
          started = false;
        }
        if (payload.type === 'delta') {
          if (!started) {
            removeToolBars();
            newAssistantMessage();
            started = true;
          }
          fullContent += payload.content;
          streamPush(payload.content);
        }
        if (payload.type === 'error') {
          removeToolBars();
          if (!started) newAssistantMessage();
          fullContent = `**错误**: ${payload.message}`;
          streamPush(fullContent);
          streamFinish();
        }
        if (payload.type === 'done') {
          removeToolBars();
          streamFinish();
          if (fullContent) {
            ChatState.messages.push({ role: 'assistant', content: fullContent });
            await Api.saveAnalysis({ path: ChatState.currentPath, messages: ChatState.messages }).catch(() => null);
          }
          ChatState.lastUserElement = null;
          setStreamingUI(false);
          return;
        }
      }
    }
  } catch (error) {
    // 用户主动终止（abortChat）走 AbortError，不展示错误，清理由 abortChat 完成
    if (error.name !== 'AbortError') {
      removeToolBars();
      if (!ChatState.streamElement) newAssistantMessage();
      updateStreamContent(renderMarkdown(`**错误**: ${error.message}`));
    }
  } finally {
    removeToolBars();
    ChatState.streaming = false;
    ChatState.abortController = null;
    setStreamingUI(false);
  }
}

async function resetConversation(node) {
  await Api.deleteAnalysis(ChatState.currentPath);
  ChatState.messages = [];
  $('chat-msgs').innerHTML = '';
  renderEmptyState(node);
}

function addUserMessage(text, messageIndex) {
  const item = document.createElement('div');
  item.className = 'chat-msg user';
  item.dataset.messageIndex = String(messageIndex);
  item.innerHTML = userMessageHTML(text);
  $('chat-msgs').appendChild(item);
  scrollChat();
  return item;
}

// 用户在生成中点击终止：中断请求，移除最新问题气泡和未完成的回复，把问题原文放回编辑框。
function abortChat() {
  if (!ChatState.streaming) return;
  if (ChatState.abortController) ChatState.abortController.abort();
  if (ChatState.streamTimer) {
    cancelAnimationFrame(ChatState.streamTimer);
    clearTimeout(ChatState.streamTimer);
    ChatState.streamTimer = null;
  }
  ChatState.streamElement?.remove();
  ChatState.streamElement = null;
  removeToolBars();
  ChatState.lastUserElement?.remove();
  ChatState.lastUserElement = null;
  if (ChatState.messages.length && ChatState.messages[ChatState.messages.length - 1].role === 'user') {
    ChatState.messages.pop();
  }
  const input = $('chat-input');
  const text = ChatState.lastUserText;
  ChatState.lastUserText = '';
  ChatState.streaming = false;
  ChatState.abortController = null;
  setStreamingUI(false);
  if (input && text) {
    input.value = text;
    autoGrowInput(input);
    input.setSelectionRange(input.value.length, input.value.length);
  }
  if (!ChatState.messages.length) renderEmptyState(ChatState.node);
}

function onChatMessagesClick(event) {
  const button = event.target.closest('.usr-delete');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  if (ChatState.streaming) return;
  deleteMessagePair(Number(button.closest('.chat-msg.user')?.dataset.messageIndex));
}

async function deleteMessagePair(index) {
  if (!Number.isInteger(index) || ChatState.messages[index]?.role !== 'user') return;
  const deleteCount = ChatState.messages[index + 1]?.role === 'assistant' ? 2 : 1;
  ChatState.messages.splice(index, deleteCount);
  if (ChatState.messages.length) {
    await Api.saveAnalysis({ path: ChatState.currentPath, messages: ChatState.messages }).catch(() => null);
    renderSavedMessages(ChatState.messages);
  } else {
    await Api.deleteAnalysis(ChatState.currentPath);
    $('chat-msgs').innerHTML = '';
    renderEmptyState(ChatState.node);
  }
}

function renderSavedMessages(messages) {
  ChatState.messages = messages;
  const host = $('chat-msgs');
  host.innerHTML = '';
  messages.forEach((message, index) => {
    const item = document.createElement('div');
    item.className = `chat-msg ${message.role === 'user' ? 'user' : 'assistant'}`;
    if (message.role === 'user') item.dataset.messageIndex = String(index);
    item.innerHTML = message.role === 'user' ? userMessageHTML(message.content) : `<div class="doc-body">${renderMarkdown(message.content)}</div>`;
    host.appendChild(item);
  });
  scrollChat();
}

function userMessageHTML(text) {
  return `<div class="usr-banner">
    <span class="usr-label">Q</span>
    <span class="usr-text">${escapeHTML(text)}</span>
    <button class="usr-delete" type="button" title="删除此轮对话" aria-label="删除此轮对话">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h18"></path>
        <path d="M8 6V4h8v2"></path>
        <path d="M19 6l-1 14H6L5 6"></path>
        <path d="M10 11v5"></path>
        <path d="M14 11v5"></path>
      </svg>
    </button>
  </div>`;
}

function newAssistantMessage() {
  finalizeStreamElement();
  ChatState.streamElement = document.createElement('div');
  ChatState.streamElement.className = 'chat-msg assistant';
  ChatState.streamElement.innerHTML = '<div class="doc-body"></div><span class="stream-cursor"></span>';
  $('chat-msgs').appendChild(ChatState.streamElement);
}

function streamPush(delta) {
  ChatState.buffer += delta;
  if (!ChatState.streamTimer) ChatState.streamTimer = requestAnimationFrame(streamTick);
}

function streamTick() {
  if (!ChatState.buffer.length) {
    ChatState.streamTimer = ChatState.streaming ? requestAnimationFrame(streamTick) : null;
    return;
  }
  const count = ChatState.buffer.length > 600 ? 20 : ChatState.buffer.length > 200 ? 8 : ChatState.buffer.length > 60 ? 3 : 1;
  ChatState.displayed += ChatState.buffer.slice(0, count);
  ChatState.buffer = ChatState.buffer.slice(count);
  updateStreamContent(renderMarkdown(ChatState.displayed));
  ChatState.streamTimer = setTimeout(streamTick, ChatState.buffer.length > 600 ? 8 : ChatState.buffer.length > 200 ? 16 : 32);
}

function streamFinish() {
  if (ChatState.buffer) {
    ChatState.displayed += ChatState.buffer;
    ChatState.buffer = '';
    updateStreamContent(renderMarkdown(ChatState.displayed));
  }
  if (ChatState.streamTimer) clearTimeout(ChatState.streamTimer);
  ChatState.streamTimer = null;
  finalizeStreamElement();
  ChatState.streaming = false;
}

function updateStreamContent(html) {
  if (ChatState.streamElement) ChatState.streamElement.querySelector('.doc-body').innerHTML = html;
  scrollChat();
}

function finalizeStreamElement() {
  ChatState.streamElement?.querySelector('.stream-cursor')?.remove();
  ChatState.streamElement = null;
}

function discardStreamElement() {
  if (ChatState.streamTimer) {
    cancelAnimationFrame(ChatState.streamTimer);
    clearTimeout(ChatState.streamTimer);
    ChatState.streamTimer = null;
  }
  ChatState.streamElement?.remove();
  ChatState.streamElement = null;
  ChatState.buffer = '';
  ChatState.displayed = '';
}

function ensureThinkingBar() {
  const item = document.createElement('div');
  item.className = 'chat-msg tool thinking';
  item.innerHTML = toolBarHTML({
    title: '规划分析路径',
    detail: 'AI 正在判断该先看结构、关键文件还是局部代码',
    status: '思考中',
  });
  $('chat-msgs').appendChild(item);
  ChatState.thinkingElement = item;
  scrollChat();
}

function addToolBar(name, args) {
  ChatState.thinkingElement?.remove();
  ChatState.thinkingElement = null;
  const item = document.createElement('div');
  const copy = describeTool(name, args);
  item.className = 'chat-msg tool pending';
  item.innerHTML = toolBarHTML({ ...copy, status: '进行中' });
  $('chat-msgs').appendChild(item);
  scrollChat();
}

function ensureAnalysisBar() {
  ChatState.thinkingElement?.remove();
  ChatState.thinkingElement = null;
  if (ChatState.analysisElement?.isConnected) return;
  const item = document.createElement('div');
  item.className = 'chat-msg tool analyzing';
  item.innerHTML = toolBarHTML({
    title: '整合证据并生成回答',
    detail: 'AI 已完成本轮工具读取，正在组织结论、证据和下一步建议',
    status: '分析中',
  });
  $('chat-msgs').appendChild(item);
  ChatState.analysisElement = item;
  scrollChat();
}

function removeAnalysisBar() {
  ChatState.analysisElement?.remove();
  ChatState.analysisElement = null;
}

function updateLastToolBar(summary, ok) {
  const bars = $('chat-msgs').querySelectorAll('.chat-msg.tool.pending');
  const bar = bars[bars.length - 1];
  if (!bar) return;
  bar.classList.remove('pending');
  bar.classList.add(ok ? 'done' : 'fail');
  bar.querySelector('.tool-status').textContent = ok ? '完成' : '失败';
  bar.querySelector('.tool-spin').textContent = ok ? '✓' : '×';
  if (summary) {
    const detail = bar.querySelector('.tool-detail');
    detail.textContent = `${detail.textContent} · ${summary}`;
  }
}

function removeToolBars() {
  $('chat-msgs').querySelectorAll('.chat-msg.tool').forEach((bar) => bar.remove());
  ChatState.thinkingElement = null;
  ChatState.analysisElement = null;
}

function toolBarHTML({ title, detail, status }) {
  return `<div class="tool-indicator">
    <span class="tool-orbit"><span class="tool-icon">◇</span></span>
    <span class="tool-copy">
      <span class="tool-title">${escapeHTML(title)}</span>
      <span class="tool-detail">${escapeHTML(truncate(detail, 96))}</span>
    </span>
    <span class="tool-status">${escapeHTML(status)}</span>
    <span class="tool-dots"><i></i><i></i><i></i></span>
    <span class="tool-spin">◌</span>
  </div>`;
}

function describeTool(name, args = {}) {
  const descriptor = TOOL_COPY[name];
  if (!descriptor) return { title: name, detail: JSON.stringify(args).slice(0, 120) };
  return { title: descriptor.title, detail: descriptor.detail(args) };
}

function prettyPath(path) {
  return path ? `/${path}` : '/';
}

function setStreamingUI(streaming) {
  const input = $('chat-input');
  const send = $('chat-send');
  const presets = $('chat-presets');
  if (input) input.disabled = streaming;
  if (presets) presets.disabled = streaming;
  $('chat-msgs')?.querySelectorAll('.usr-delete').forEach((button) => {
    button.disabled = streaming;
  });
  if (streaming) closePresetPop();
  if (send) {
    // 生成中：纸飞机变为终止按钮（仍可点击）；否则恢复发送
    send.disabled = false;
    send.classList.toggle('is-stop', streaming);
    send.title = streaming ? '终止生成' : '发送（Ctrl/⌘+Enter）';
    send.setAttribute('aria-label', streaming ? '终止生成' : '发送');
    send.innerHTML = streaming ? STOP_ICON : SEND_ICON;
  }
  if (!streaming) input?.focus();
}

function scrollChat() {
  const host = $('chat-msgs');
  host?.scrollTo({ top: host.scrollHeight, behavior: 'smooth' });
}
