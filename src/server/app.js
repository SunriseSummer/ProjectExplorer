import fs from 'node:fs';
import http from 'node:http';
import { createAnalysisStore } from './analysis-store.js';
import { loadAnnotations } from './annotations.js';
import { createApiRouter } from './api-router.js';
import { createAgentService } from './agent-service.js';
import { createConfigStore } from './config-store.js';
import { ANALYSES_DIR, CONFIG_FILE, PORT, PROJECT_DIR, PROJECT_NAME, PUBLIC_DIR } from './paths.js';
import { createProjectService } from './project-service.js';
import { serveStatic } from './static-service.js';
import { sendJSON } from './http-utils.js';

export async function startServer() {
  const configStore = createConfigStore(CONFIG_FILE);
  const analysisStore = createAnalysisStore(ANALYSES_DIR);
  const projectService = createProjectService(PROJECT_DIR, PROJECT_NAME, configStore);
  const annotations = await loadAnnotations(PROJECT_NAME);
  const agentService = createAgentService({ projectService, configStore });
  const handleApi = createApiRouter({ annotations, analysisStore, agentService, configStore, projectService });

  if (!fs.existsSync(PROJECT_DIR)) {
    console.warn(`未找到被分析项目目录: ${PROJECT_DIR}`);
    console.warn('请将待学习项目放到 ./project，或设置 PROJECT_DIR 指向目标路径。');
  }

  await configStore.load();
  await analysisStore.migrateLegacyFiles();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(url, req, res);
      else await serveStatic(PUBLIC_DIR, url, res);
    } catch (error) {
      sendJSON(res, 500, { error: error.message });
    }
  });

  server.listen(PORT, () => {
    console.log('\n  ProjectExplorer 已启动');
    console.log(`  ├ 分析项目: ${PROJECT_DIR}`);
    console.log(`  └ 打开浏览器: http://localhost:${PORT}\n`);
  });

  return server;
}
