export async function testProviderConnection(draft) {
  if (!draft) return { ok: false, message: '未知服务' };
  if (!draft.apiKey) return { ok: false, message: '未配置 API Key' };

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);

  try {
    const response = await fetch(draft.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${draft.apiKey}` },
      body: JSON.stringify({
        model: draft.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: ctrl.signal,
    });

    const latencyMs = Date.now() - started;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || `HTTP ${response.status}`;
      return { ok: false, message: String(detail).slice(0, 200), latencyMs };
    }
    return { ok: true, message: `连接正常 · ${data?.model || draft.model} · ${latencyMs}ms`, latencyMs, model: data?.model || draft.model };
  } catch (error) {
    return { ok: false, message: error.name === 'AbortError' ? '连接超时（30s）' : `连接失败: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}
