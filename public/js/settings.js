import { Api } from './api.js';
import { $, escapeAttr, escapeHTML } from './utils.js';

export const Settings = {
  cfg: null,
  selectedProvider: null,
  draftActive: null,
  mode: 'providers',

  modelLabel(providerId, modelId) {
    const model = this.cfg?.catalog?.[providerId]?.models.find((item) => item.id === modelId);
    return model ? model.label : modelId;
  },

  async refreshFooter() {
    try {
      this.cfg = await Api.config();
      const id = this.cfg.activeProvider;
      const provider = this.cfg.providers[id];
      const label = this.cfg.catalog[id]?.label || id;
      $('foot-model').textContent = `${label} / ${provider ? this.modelLabel(id, provider.model) : ''}`;
    } catch {
      $('foot-model').textContent = '未配置';
    }
  },

  async open() {
    $('settings-modal').hidden = false;
    $('settings-status').textContent = '';
    $('settings-body').innerHTML = '<div class="loading">正在加载配置...</div>';
    try {
      this.cfg = await Api.config();
      this.selectedProvider = this.cfg.activeProvider;
      this.draftActive = this.cfg.activeProvider;
      this.mode = 'providers';
      this.render();
    } catch (error) {
      $('settings-body').innerHTML = `<div class="loading" style="color:var(--red)">加载失败：${escapeHTML(error.message)}</div>`;
    }
  },

  close() {
    $('settings-modal').hidden = true;
  },

  render() {
    const seg = `<div class="settings-seg">
      <button class="seg-btn${this.mode === 'providers' ? ' active' : ''}" data-mode="providers">模型服务</button>
      <button class="seg-btn${this.mode === 'agent' ? ' active' : ''}" data-mode="agent">Agent 策略</button>
    </div>`;
    $('settings-body').innerHTML = seg + (this.mode === 'agent' ? this.renderAgent() : this.renderProviders());

    $('settings-body').querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.captureCurrent();
        this.mode = button.dataset.mode;
        this.render();
      });
    });
    if (this.mode === 'agent') this.bindAgent();
    else this.bindProviders();
  },

  renderProviders() {
    const ids = Object.keys(this.cfg.catalog);
    const activeLabel = this.cfg.catalog[this.draftActive]?.label || this.draftActive;
    const activeModel = this.cfg.providers[this.draftActive] ? this.modelLabel(this.draftActive, this.cfg.providers[this.draftActive].model) : '';
    const tabs = ids.map((id) => {
      const hasKey = this.cfg.providers[id].hasKey;
      return `<button class="prov-tab${id === this.selectedProvider ? ' active' : ''}${hasKey ? ' has-key' : ''}" data-id="${id}"><span class="tickdot"></span>${escapeHTML(this.cfg.catalog[id].label)}</button>`;
    }).join('');
    return `<div class="active-banner">当前生效：<b>${escapeHTML(activeLabel)} / ${escapeHTML(activeModel)}</b></div><div class="prov-tabs">${tabs}</div>${ids.map((id) => this.renderProviderPanel(id)).join('')}`;
  },

  bindProviders() {
    $('settings-body').querySelectorAll('.prov-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.captureDraft();
        this.selectedProvider = tab.dataset.id;
        this.render();
      });
    });
    $('settings-body').querySelectorAll('[data-setactive]').forEach((button) => {
      button.addEventListener('click', () => {
        this.captureDraft();
        this.draftActive = button.dataset.setactive;
        this.render();
      });
    });
    $('settings-body').querySelectorAll('[data-test]').forEach((button) => {
      button.addEventListener('click', () => this.test(button.dataset.test, button));
    });
  },

  renderAgent() {
    const schema = this.cfg.agentSchema || [];
    const agent = this.cfg.agent || {};
    const groups = [];
    for (const field of schema) {
      let group = groups.find((item) => item.name === field.group);
      if (!group) { group = { name: field.group, fields: [] }; groups.push(group); }
      group.fields.push(field);
    }
    const groupHTML = groups.map((group) => {
      const fields = group.fields.map((field) => {
        const value = agent[field.key] ?? field.def;
        return `<div class="field agent-field">
          <label>${escapeHTML(field.label)}<span class="agent-range">${field.min}–${field.max}${field.unit ? ' ' + escapeHTML(field.unit) : ''}</span></label>
          <input type="number" data-ak="${escapeAttr(field.key)}" value="${escapeAttr(String(value))}" min="${field.min}" max="${field.max}" step="1" data-def="${field.def}">
          <div class="hint">${escapeHTML(field.hint)}</div>
        </div>`;
      }).join('');
      return `<div class="agent-group"><div class="agent-group-title">${escapeHTML(group.name)}</div><div class="agent-grid">${fields}</div></div>`;
    }).join('');
    return `<div class="active-banner">这些参数控制 AI 问答时读取项目信息的范围与预算，保存后立即生效。默认上下文较大，可按质量/成本权衡调整。</div>
      ${groupHTML}
      <div class="agent-foot"><button class="btn-ghost" id="agent-reset">恢复默认值</button></div>`;
  },

  bindAgent() {
    const reset = $('agent-reset');
    if (reset) reset.addEventListener('click', () => {
      $('settings-body').querySelectorAll('[data-ak]').forEach((input) => { input.value = input.dataset.def; });
    });
  },

  captureCurrent() {
    if (this.mode === 'agent') this.captureAgent();
    else this.captureDraft();
  },

  captureAgent() {
    const agent = this.cfg.agent || (this.cfg.agent = {});
    $('settings-body').querySelectorAll('[data-ak]').forEach((input) => {
      const num = Number(input.value);
      if (Number.isFinite(num)) agent[input.dataset.ak] = num;
    });
  },

  renderProviderPanel(id) {
    const provider = this.cfg.providers[id];
    const catalog = this.cfg.catalog[id];
    const known = catalog.models.some((model) => model.id === provider.model);
    const models = known ? catalog.models : [{ id: provider.model, label: provider.model }, ...catalog.models];
    const options = models.map((model) => `<option value="${escapeAttr(model.id)}"${model.id === provider.model ? ' selected' : ''}>${escapeHTML(model.label)}</option>`).join('');
    const isActive = id === this.draftActive;
    const keyPlaceholder = provider.hasKey ? `已配置（${provider.keyHint}），留空则不修改` : '请输入 API Key';
    return `<div class="prov-panel${id === this.selectedProvider ? ' active' : ''}" data-panel="${id}">
      <div class="field"><label>模型</label><select data-f="model">${options}</select></div>
      <div class="field"><label>API Key</label><input type="password" data-f="apiKey" class="mono" autocomplete="off" placeholder="${escapeAttr(keyPlaceholder)}"><div class="hint">密钥保存在本地 config.json；接口返回时会自动脱敏。</div></div>
      <div class="field"><label>接口地址（Base URL）</label><input type="text" data-f="baseURL" class="mono" value="${escapeAttr(provider.baseURL)}" placeholder="${escapeAttr(catalog.baseURL)}"><div class="hint">使用 OpenAI 兼容的 chat/completions 地址。</div></div>
      <div class="prov-actions">
        <button class="set-active-btn${isActive ? ' is-active' : ''}" data-setactive="${id}">${isActive ? '✓ 当前生效服务' : '设为当前服务'}</button>
        <button class="test-btn" data-test="${id}">测试服务</button>
        <span class="test-result" data-testresult="${id}"></span>
      </div>
    </div>`;
  },

  captureDraft() {
    const panel = $('settings-body').querySelector(`.prov-panel[data-panel="${this.selectedProvider}"]`);
    if (!panel) return;
    const provider = this.cfg.providers[this.selectedProvider];
    provider.model = panel.querySelector('[data-f="model"]').value;
    provider.baseURL = panel.querySelector('[data-f="baseURL"]').value;
    provider._pendingKey = panel.querySelector('[data-f="apiKey"]').value;
  },

  async test(id, button) {
    this.captureDraft();
    const provider = this.cfg.providers[id];
    const result = document.querySelector(`[data-testresult="${id}"]`);
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '测试中...';
    if (result) {
      result.className = 'test-result';
      result.textContent = '正在连接...';
    }
    try {
      const payload = { provider: id, model: provider.model, baseURL: provider.baseURL };
      if (provider._pendingKey) payload.apiKey = provider._pendingKey;
      const response = await Api.testConfig(payload);
      if (result) {
        result.className = `test-result ${response.ok ? 'ok' : 'err'}`;
        result.textContent = `${response.ok ? '✓ ' : '× '}${response.message || ''}`;
      }
    } catch (error) {
      if (result) {
        result.className = 'test-result err';
        result.textContent = `× ${error.message}`;
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  },

  async save() {
    this.captureCurrent();
    const status = $('settings-status');
    const saveButton = $('settings-save');
    const payload = { activeProvider: this.draftActive, providers: {}, agent: this.cfg.agent || {} };
    for (const id of Object.keys(this.cfg.providers)) {
      const provider = this.cfg.providers[id];
      payload.providers[id] = { model: provider.model, baseURL: provider.baseURL };
      if (provider._pendingKey) payload.providers[id].apiKey = provider._pendingKey;
    }
    saveButton.disabled = true;
    status.className = 'modal-status';
    status.textContent = '保存中...';
    try {
      this.cfg = await Api.saveConfig(payload);
      status.className = 'modal-status ok';
      status.textContent = '已保存';
      await this.refreshFooter();
      setTimeout(() => this.close(), 500);
    } catch (error) {
      status.className = 'modal-status err';
      status.textContent = `保存失败：${error.message}`;
    } finally {
      saveButton.disabled = false;
    }
  },
};

export function initSettings() {
  $('btn-settings').addEventListener('click', () => Settings.open());
  $('settings-close').addEventListener('click', () => Settings.close());
  $('settings-cancel').addEventListener('click', () => Settings.close());
  $('settings-save').addEventListener('click', () => Settings.save());
  $('settings-modal').addEventListener('click', (event) => {
    if (event.target.id === 'settings-modal') Settings.close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('settings-modal').hidden) Settings.close();
  });
}
