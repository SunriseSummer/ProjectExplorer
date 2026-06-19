import fsp from 'node:fs/promises';
import { firstModelId, isKnownProvider, PROVIDER_CATALOG, PROVIDER_TEMPERATURE } from './provider-catalog.js';

// 可由用户在设置页 / config.json 中调节的 Agent 策略参数。
// def 为默认值，[min,max] 为允许范围（保存时会被夹紧），group 用于设置页分组展示。
export const AGENT_STRATEGY_SCHEMA = [
  { key: 'fileContextMaxChars', label: '预注入文件内容上限', unit: '字符', hint: '针对某个文件提问时，直接放入系统提示的文件内容字符上限；超出部分标注[已截断]，可由 Agent 用工具补读。', def: 200 * 1024, min: 4096, max: 1024 * 1024, group: '上下文注入' },
  { key: 'treeSnapshotMaxChars', label: '项目树快照上限', unit: '字符', hint: '系统提示中项目结构快照的字符上限。', def: 24000, min: 1000, max: 200000, group: '上下文注入' },
  { key: 'toolFileMaxChars', label: 'read_file 单文件上限', unit: '字符', hint: 'read_file 工具单次读取整个文件的字符上限；超出建议改用 read_file_slice。', def: 200 * 1024, min: 4096, max: 1024 * 1024, group: '工具读取' },
  { key: 'fileSliceMaxLines', label: 'read_file_slice 最大行数', unit: '行', hint: 'read_file_slice 工具单次返回的最大行数。', def: 1200, min: 50, max: 5000, group: '工具读取' },
  { key: 'searchMaxMatches', label: '搜索最大命中数', unit: '条', hint: 'search_code / search_code_context 单次返回的最大命中条数。', def: 60, min: 5, max: 500, group: '工具读取' },
  { key: 'searchMaxFiles', label: '搜索扫描文件上限', unit: '个', hint: '代码搜索单次扫描的文件数量上限。', def: 600, min: 20, max: 5000, group: '工具读取' },
  { key: 'maxAgentTurns', label: '最大对话轮数', unit: '轮', hint: '单次提问中 Agent 与模型往返的最大轮数。', def: 16, min: 1, max: 60, group: '工具预算' },
  { key: 'maxToolCallsPerTurn', label: '单轮最大工具调用数', unit: '个', hint: '每一轮允许并行执行的工具调用数量。', def: 8, min: 1, max: 20, group: '工具预算' },
  { key: 'maxTotalToolCalls', label: '累计最大工具调用数', unit: '个', hint: '单次提问累计可执行的工具调用总数。', def: 35, min: 1, max: 200, group: '工具预算' },
  { key: 'toolResultMaxChars', label: '单个工具结果上限', unit: '字符', hint: '单个工具返回结果注入上下文前的字符上限。', def: 32000, min: 1000, max: 200000, group: '工具预算' },
  { key: 'maxTotalToolResultChars', label: '累计工具结果上限', unit: '字符', hint: '成本闸门：累计工具结果字符数达到此值后停止再调用工具、转入作答。', def: 420000, min: 10000, max: 4000000, group: '工具预算' },
  { key: 'maxTokens', label: '单次回答最大 tokens', unit: 'tokens', hint: '每次请求模型生成的最大 token 数。', def: 4096, min: 256, max: 32000, group: '输出与流式' },
  { key: 'streamForwardMinChars', label: '流式转发攒字阈值', unit: '字符', hint: '实时转发正文前先攒够的字符数，用于在工具轮拦截模型旁白，避免正文闪现。调大更稳但首字延迟略增。', def: 48, min: 0, max: 2000, group: '输出与流式' },
];

function defaultAgentStrategy() {
  const agent = {};
  for (const field of AGENT_STRATEGY_SCHEMA) agent[field.key] = field.def;
  return agent;
}

function normalizeAgentStrategy(raw, base = defaultAgentStrategy()) {
  const agent = { ...base };
  if (!raw || typeof raw !== 'object') return agent;
  for (const field of AGENT_STRATEGY_SCHEMA) {
    const value = Number(raw[field.key]);
    if (!Number.isFinite(value)) continue;
    agent[field.key] = Math.min(field.max, Math.max(field.min, Math.round(value)));
  }
  return agent;
}

export function createConfigStore(configFile) {
  let config = defaultConfig();

  function defaultConfig() {
    const providers = {};
    for (const id of Object.keys(PROVIDER_CATALOG)) {
      providers[id] = {
        apiKey: '',
        model: firstModelId(id),
        baseURL: PROVIDER_CATALOG[id].baseURL,
      };
    }
    providers.deepseek.apiKey = process.env.DEEPSEEK_API_KEY || '';
    providers.deepseek.model = process.env.DEEPSEEK_MODEL || providers.deepseek.model;
    return { activeProvider: 'deepseek', providers, agent: defaultAgentStrategy() };
  }

  function normalize(raw) {
    const next = defaultConfig();
    if (!raw || typeof raw !== 'object') return next;
    if (isKnownProvider(raw.activeProvider)) next.activeProvider = raw.activeProvider;

    const incomingProviders = raw.providers || {};
    for (const id of Object.keys(PROVIDER_CATALOG)) {
      const src = incomingProviders[id] || {};
      const dst = next.providers[id];
      if (typeof src.apiKey === 'string' && src.apiKey.trim()) dst.apiKey = src.apiKey.trim();
      if (typeof src.model === 'string' && src.model.trim()) dst.model = src.model.trim();
      if (typeof src.baseURL === 'string' && src.baseURL.trim()) dst.baseURL = src.baseURL.trim();
    }
    next.agent = normalizeAgentStrategy(raw.agent);
    return next;
  }

  async function load() {
    try {
      const raw = JSON.parse(await fsp.readFile(configFile, 'utf8'));
      config = normalize(raw);
    } catch {
      config = defaultConfig();
    }
  }

  async function persist() {
    await fsp.writeFile(configFile, JSON.stringify(config, null, 2), 'utf8');
  }

  function activeLLM() {
    const provider = isKnownProvider(config.activeProvider) ? config.activeProvider : 'deepseek';
    const stored = config.providers[provider] || {};
    return {
      provider,
      apiKey: stored.apiKey || '',
      model: stored.model || firstModelId(provider),
      baseURL: stored.baseURL || PROVIDER_CATALOG[provider].baseURL,
      temperature: PROVIDER_TEMPERATURE[provider] ?? 0.3,
    };
  }

  function publicConfig() {
    const providers = {};
    for (const id of Object.keys(PROVIDER_CATALOG)) {
      const stored = config.providers[id] || {};
      const apiKey = stored.apiKey || '';
      providers[id] = {
        model: stored.model || firstModelId(id),
        baseURL: stored.baseURL || PROVIDER_CATALOG[id].baseURL,
        hasKey: Boolean(apiKey),
        keyHint: apiKey ? `••••${apiKey.slice(-4)}` : '',
      };
    }
    return {
      activeProvider: config.activeProvider,
      catalog: PROVIDER_CATALOG,
      providers,
      agent: { ...config.agent },
      agentSchema: AGENT_STRATEGY_SCHEMA,
    };
  }

  function agentStrategy() {
    return config.agent;
  }

  function update(body) {
    if (isKnownProvider(body?.activeProvider)) config.activeProvider = body.activeProvider;
    const incomingProviders = body?.providers || {};
    for (const id of Object.keys(PROVIDER_CATALOG)) {
      const src = incomingProviders[id];
      if (!src || typeof src !== 'object') continue;
      const dst = config.providers[id];
      if (typeof src.model === 'string' && src.model.trim()) dst.model = src.model.trim();
      if (typeof src.baseURL === 'string') dst.baseURL = src.baseURL.trim() || PROVIDER_CATALOG[id].baseURL;
      if (typeof src.apiKey === 'string' && src.apiKey.trim()) dst.apiKey = src.apiKey.trim();
    }
    if (body?.agent && typeof body.agent === 'object') {
      config.agent = normalizeAgentStrategy(body.agent, config.agent);
    }
  }

  function resolveProviderDraft(draft) {
    const provider = isKnownProvider(draft?.provider) ? draft.provider : null;
    if (!provider) return null;
    const stored = config.providers[provider] || {};
    return {
      provider,
      apiKey: draft.apiKey?.trim() || stored.apiKey || '',
      model: draft.model?.trim() || stored.model || firstModelId(provider),
      baseURL: draft.baseURL?.trim() || stored.baseURL || PROVIDER_CATALOG[provider].baseURL,
      temperature: PROVIDER_TEMPERATURE[provider] ?? 0.3,
    };
  }

  return {
    load,
    persist,
    activeLLM,
    publicConfig,
    agentStrategy,
    update,
    resolveProviderDraft,
  };
}
