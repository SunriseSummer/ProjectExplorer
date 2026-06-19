import fsp from 'node:fs/promises';
import path from 'node:path';
import { MIME_TYPES } from './constants.js';
import { openSSE, readJSONBody, sendJSON } from './http-utils.js';
import { testProviderConnection } from './llm.js';

export function createApiRouter({ analysisStore, agentService, configStore, projectService }) {
  return async function handleApi(url, req, res) {
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      let body;
      try {
        body = await readJSONBody(req);
      } catch {
        return sendJSON(res, 400, { error: '无效 JSON' });
      }

      const targetPath = body.path || '';
      const nodeType = body.type || 'file';
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!projectService.safeResolve(targetPath)) return sendJSON(res, 400, { error: '路径无效' });

      openSSE(res);
      await agentService.agenticChat(targetPath, nodeType, messages, res);
      return;
    }

    if (url.pathname === '/api/tree') {
      try {
        const tree = await projectService.getTree();
        return sendJSON(res, 200, { project: projectService.projectName, rootPath: projectService.projectDir, tree });
      } catch (error) {
        return sendJSON(res, 500, { error: `无法读取项目目录: ${projectService.projectDir}; ${error.message}` });
      }
    }

    if (url.pathname === '/api/config/test' && req.method === 'POST') {
      let body;
      try {
        body = await readJSONBody(req);
      } catch {
        return sendJSON(res, 400, { error: '无效 JSON' });
      }
      return sendJSON(res, 200, await testProviderConnection(configStore.resolveProviderDraft(body)));
    }

    if (url.pathname === '/api/config') {
      if (req.method === 'GET') return sendJSON(res, 200, configStore.publicConfig());
      if (req.method === 'POST') {
        let body;
        try {
          body = await readJSONBody(req);
        } catch {
          return sendJSON(res, 400, { error: '无效 JSON' });
        }
        configStore.update(body);
        try {
          await configStore.persist();
        } catch (error) {
          return sendJSON(res, 500, { error: `保存失败: ${error.message}` });
        }
        return sendJSON(res, 200, configStore.publicConfig());
      }
      return sendJSON(res, 405, { error: 'method not allowed' });
    }

    if (url.pathname === '/api/analyze') {
      const rel = url.searchParams.get('path') || '';
      const type = url.searchParams.get('type') || 'auto';
      if (!projectService.safeResolve(rel)) return sendJSON(res, 400, { error: '路径无效' });
      try {
        return sendJSON(res, 200, await agentService.analyzeNonStream(rel, type));
      } catch (error) {
        return sendJSON(res, 500, { error: `分析失败: ${error.message}` });
      }
    }

    if (url.pathname === '/api/file') {
      const result = await projectService.readFilePreview(url.searchParams.get('path') || '');
      return sendJSON(res, result.status, result.body);
    }

    if (url.pathname === '/api/raw') {
      const rel = url.searchParams.get('path') || '';
      const abs = projectService.safeResolve(rel);
      if (!abs) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad path');
        return;
      }
      try {
        const ext = path.extname(abs).toLowerCase();
        const buffer = await fsp.readFile(abs);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(buffer);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
      }
      return;
    }

    if (url.pathname === '/api/analysis') {
      if (req.method === 'GET') {
        const data = await analysisStore.load(url.searchParams.get('path') || '');
        return data ? sendJSON(res, 200, data) : sendJSON(res, 404, { error: 'no saved analysis' });
      }
      if (req.method === 'POST') {
        let body;
        try {
          body = await readJSONBody(req);
        } catch {
          return sendJSON(res, 400, { error: '无效 JSON' });
        }
        const rel = body.path || '';
        if (!projectService.safeResolve(rel)) return sendJSON(res, 400, { error: '路径无效' });
        await analysisStore.save(rel, body);
        return sendJSON(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        await analysisStore.remove(url.searchParams.get('path') || '');
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 405, { error: 'method not allowed' });
    }

    return sendJSON(res, 404, { error: 'unknown api' });
  };
}
