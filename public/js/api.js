export async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export const Api = {
  tree: () => fetchJSON('/api/tree'),
  config: () => fetchJSON('/api/config'),
  saveConfig: (payload) => fetchJSON('/api/config', jsonOptions(payload)),
  testConfig: (payload) => fetchJSON('/api/config/test', jsonOptions(payload)),
  file: (path) => fetchJSON(`/api/file?path=${encodeURIComponent(path)}`),
  analysis: (path) => fetchJSON(`/api/analysis?path=${encodeURIComponent(path)}`),
  saveAnalysis: (payload) => fetchJSON('/api/analysis', jsonOptions(payload)),
  deleteAnalysis: (path) => fetch(`/api/analysis?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).catch(() => null),
};

export function jsonOptions(payload) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}
