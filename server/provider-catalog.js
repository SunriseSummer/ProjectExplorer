const makeModels = (...ids) => ids.map((id) => ({ id, label: id }));

export const PROVIDER_CATALOG = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/chat/completions',
    models: makeModels('deepseek-v4-pro', 'deepseek-v4-flash'),
  },
  glm: {
    label: 'GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: makeModels('glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7'),
  },
  kimi: {
    label: 'KIMI',
    baseURL: 'https://api.moonshot.cn/v1/chat/completions',
    models: makeModels('kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.5', 'moonshot-v1-128k'),
  },
  qwen: {
    label: 'Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    models: makeModels('qwen3.7-max', 'qwen3.7-plus', 'qwen3.5-flash', 'qwen3-max'),
  },
};

export const PROVIDER_TEMPERATURE = {
  deepseek: 0.3,
  glm: 0.3,
  qwen: 0.3,
  kimi: 1,
};

export function firstModelId(providerId) {
  return PROVIDER_CATALOG[providerId].models[0].id;
}

export function isKnownProvider(providerId) {
  return Object.prototype.hasOwnProperty.call(PROVIDER_CATALOG, providerId);
}
