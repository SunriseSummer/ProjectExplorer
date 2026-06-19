import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  BINARY_EXTENSIONS,
  EXTENSION_LABELS,
  FILE_MAX_CHARS,
  FILE_PREVIEW_MAX,
  formatSize,
  IGNORED_NAMES,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  TOOL_FILE_MAX,
} from './constants.js';

const OUTLINE_PATTERNS = [
  /^\s*(export\s+)?(async\s+)?function\s+([\w$]+)/,
  /^\s*(export\s+)?class\s+([\w$]+)/,
  /^\s*(export\s+)?(const|let|var)\s+([\w$]+)\s*=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*=>/,
  /^\s*(export\s+)?(interface|type|enum)\s+([\w$]+)/,
  /^\s*(public|private|protected)?\s*(async\s+)?([\w$]+)\s*\([^)]*\)\s*[:{]/,
];

const IMPORTANT_NAME_RE = /(^|\/)(package\.json|README(\.\w+)?\.md|tsconfig\.json|vite\.config\.[\w.]+|webpack\.config\.[\w.]+|rollup\.config\.[\w.]+|next\.config\.[\w.]+|go\.mod|Cargo\.toml|pyproject\.toml|setup\.py|requirements\.txt|pom\.xml|build\.gradle(\.kts)?|CMakeLists\.txt|Makefile|Dockerfile|src\/(main|index|app|server)\.[\w.]+)$/i;
const ENTRY_NAME_RE = /(^|\/)(main|index|app|server|router|routes|store|config|bootstrap|entry|__main__|manage|cmd)\.(ts|tsx|js|jsx|mjs|cjs|ets|py|go|rs|java|kt)$/i;
const TEST_NAME_RE = /(\.test\.|\.spec\.|\/test\/|\/tests\/|\/__tests__\/)/i;

export function createProjectService(projectDir, projectName, configStore = null) {
  let treeCache = null;

  // 读取用户可调的策略参数；未注入 configStore 时回退到常量默认值。
  function strat() {
    return configStore?.agentStrategy?.() || {};
  }

  function safeResolve(rel = '') {
    const clean = path.normalize(rel).replace(/^([/\\])+/, '');
    const abs = path.resolve(projectDir, clean);
    if (abs !== projectDir && !abs.startsWith(projectDir + path.sep)) return null;
    return abs;
  }

  async function buildTree(absDir, relDir = '') {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const dirs = [];
    const files = [];

    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(await buildTree(abs, rel));
      } else if (entry.isFile()) {
        const stat = await fsp.stat(abs).catch(() => ({ size: 0 }));
        files.push({
          name: entry.name,
          path: rel,
          type: 'file',
          ext: path.extname(entry.name).toLowerCase(),
          size: stat.size,
        });
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { name: relDir ? path.basename(relDir) : projectName, path: relDir, type: 'dir', children: [...dirs, ...files] };
  }

  async function getTree() {
    if (!treeCache) treeCache = await buildTree(projectDir);
    return treeCache;
  }

  async function listDir(absDir, relDir = '') {
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const children = [];
    for (const entry of entries) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      const isFile = entry.isFile();
      const stat = isFile ? await fsp.stat(abs).catch(() => ({ size: 0 })) : { size: 0 };
      children.push({
        name: entry.name,
        path: rel,
        type: entry.isDirectory() ? 'dir' : 'file',
        ext: isFile ? path.extname(entry.name).toLowerCase() : '',
        size: stat.size,
      });
    }
    children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return children;
  }

  function compactTree(node, indent = '') {
    let result = `${indent}${node.name}${node.type === 'dir' ? '/' : ''}`;
    if (node.type === 'file' && node.size) result += ` (${formatSize(node.size)})`;
    result += '\n';
    for (const child of node.children || []) result += compactTree(child, `${indent}  `);
    return result;
  }

  function countNodes(node) {
    return 1 + (node.children || []).reduce((sum, child) => sum + countNodes(child), 0);
  }

  async function readContext(targetPath, nodeType) {
    const abs = safeResolve(targetPath);
    if (!abs) return { kind: 'error', content: '(路径无效)' };

    if (nodeType === 'dir') {
      try {
        const children = await listDir(abs, targetPath);
        const content = children.length
          ? children.map((child) => `- ${child.name}${child.type === 'dir' ? '/' : ` (${formatSize(child.size || 0)})`}`).join('\n')
          : '(空目录)';
        return { kind: 'dir_listing', content };
      } catch (error) {
        return { kind: 'error', content: `(无法读取目录: ${error.message})` };
      }
    }

    try {
      const stat = await fsp.stat(abs);
      if (!stat.isFile()) return { kind: 'error', content: '(不是文件)' };
      const ext = path.extname(abs).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext) || BINARY_EXTENSIONS.has(ext)) {
        return { kind: 'binary', content: `(二进制文件 ${ext}, ${formatSize(stat.size)})` };
      }
      const buffer = await fsp.readFile(abs);
      if (buffer.subarray(0, 8192).includes(0)) return { kind: 'binary', content: `(二进制文件 ${formatSize(buffer.length)})` };
      const maxChars = strat().fileContextMaxChars || FILE_MAX_CHARS;
      const truncated = buffer.length > maxChars;
      const content = buffer.toString('utf8').slice(0, maxChars);
      return { kind: 'text', content, truncated, lang: EXTENSION_LABELS[ext] || ext.slice(1).toUpperCase(), size: stat.size };
    } catch (error) {
      return { kind: 'error', content: `(无法读取文件: ${error.message})` };
    }
  }

  async function readFilePreview(rel) {
    const abs = safeResolve(rel);
    if (!abs) return { status: 400, body: { error: '路径无效' } };
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat) return { status: 404, body: { error: '文件不存在' } };
    if (!stat.isFile()) return { status: 400, body: { error: '不是文件' } };

    const ext = path.extname(abs).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) return { status: 200, body: { kind: 'image', ext, size: stat.size, path: rel } };
    if (BINARY_EXTENSIONS.has(ext)) return { status: 200, body: { kind: 'binary', ext, size: stat.size, path: rel } };

    const buffer = await fsp.readFile(abs);
    if (buffer.subarray(0, 8192).includes(0)) return { status: 200, body: { kind: 'binary', ext, size: stat.size, path: rel } };
    const content = buffer.subarray(0, FILE_PREVIEW_MAX).toString('utf8');
    return {
      status: 200,
      body: {
        kind: 'text',
        ext,
        size: stat.size,
        truncated: stat.size > FILE_PREVIEW_MAX,
        lines: content.split(/\r\n|\r|\n/).length,
        content,
        path: rel,
      },
    };
  }

  async function toolReadFile(rel) {
    const abs = safeResolve(rel);
    if (!abs) return { ok: false, error: `路径无效: ${rel}` };
    const stat = await fsp.stat(abs).catch((error) => ({ error }));
    if (stat.error) return { ok: false, error: stat.error.message };

    if (stat.isDirectory()) {
      const children = await listDir(abs, rel);
      return { ok: true, isDir: true, items: children, content: formatDirItems(children), summary: `${children.length} 项` };
    }

    const ext = path.extname(abs).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext) || BINARY_EXTENSIONS.has(ext)) {
      return { ok: true, isBinary: true, content: `[二进制文件 ${ext}, ${formatSize(stat.size)}]`, summary: `${formatSize(stat.size)} 二进制` };
    }

    const buffer = await fsp.readFile(abs);
    let content = buffer.toString('utf8');
    const toolFileMax = strat().toolFileMaxChars || TOOL_FILE_MAX;
    const truncated = buffer.length > toolFileMax;
    if (truncated) content = `${content.slice(0, toolFileMax)}\n... [文件已截断，共 ${formatSize(buffer.length)}；如需细读请使用 read_file_slice]`;
    return { ok: true, content, size: stat.size, truncated, lang: EXTENSION_LABELS[ext] || '' };
  }

  async function readFileSlice(rel, startLine = 1, endLine = startLine + 120) {
    const abs = safeResolve(rel);
    if (!abs) return { ok: false, error: `路径无效: ${rel}` };
    const stat = await fsp.stat(abs).catch((error) => ({ error }));
    if (stat.error) return { ok: false, error: stat.error.message };
    if (!stat.isFile()) return { ok: false, error: '不是文件' };

    const ext = path.extname(abs).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return { ok: false, error: `不支持按行读取的文件类型: ${ext || '(unknown)'}` };

    const lines = (await fsp.readFile(abs, 'utf8')).split(/\r\n|\r|\n/);
    const maxSliceLines = strat().fileSliceMaxLines || 700;
    const from = clamp(Number(startLine) || 1, 1, lines.length);
    const to = clamp(Number(endLine) || from + 120, from, Math.min(lines.length, from + maxSliceLines));
    const numbered = lines.slice(from - 1, to).map((line, index) => `${from + index}: ${line}`).join('\n');
    return {
      ok: true,
      content: numbered,
      startLine: from,
      endLine: to,
      totalLines: lines.length,
      summary: `${rel}:${from}-${to}`,
    };
  }

  async function getFileOutline(rel) {
    const abs = safeResolve(rel);
    if (!abs) return { ok: false, error: `路径无效: ${rel}` };
    const stat = await fsp.stat(abs).catch((error) => ({ error }));
    if (stat.error) return { ok: false, error: stat.error.message };
    if (!stat.isFile()) return { ok: false, error: '不是文件' };

    const ext = path.extname(abs).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return { ok: false, error: `不支持提取大纲的文件类型: ${ext || '(unknown)'}` };

    const lines = (await fsp.readFile(abs, 'utf8')).split(/\r\n|\r|\n/);
    const imports = [];
    const symbols = [];
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (imports.length < 30 && /^(import|export\s+.*from|const\s+\w+\s*=\s*require\()/u.test(trimmed)) {
        imports.push({ line: index + 1, text: trimmed.slice(0, 180) });
      }
      for (const pattern of OUTLINE_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          symbols.push({ line: index + 1, text: trimmed.slice(0, 180) });
          break;
        }
      }
    });
    const content = [
      `文件: ${rel}`,
      `行数: ${lines.length}`,
      '',
      '导入/导出:',
      ...(imports.length ? imports.map((item) => `- L${item.line}: ${item.text}`) : ['- (未发现显式导入/导出)']),
      '',
      '主要符号:',
      ...(symbols.length ? symbols.slice(0, 80).map((item) => `- L${item.line}: ${item.text}`) : ['- (未发现常见函数/类/类型定义)']),
    ].join('\n');
    return { ok: true, imports, symbols, totalLines: lines.length, content, summary: `${symbols.length} 个符号` };
  }

  async function getProjectMap(rel = '', maxDepth = 2, maxEntries = 160) {
    const rootAbs = rel ? safeResolve(rel) : projectDir;
    if (!rootAbs) return { ok: false, error: `路径无效: ${rel}` };
    const baseDepth = rel ? rel.split('/').filter(Boolean).length : 0;
    const entries = [];
    const stats = { dirs: 0, files: 0, textFiles: 0, binaryFiles: 0, totalBytes: 0, byExt: {} };

    async function walk(absDir, relDir, depth) {
      if (entries.length >= maxEntries) return;
      const children = await listDir(absDir, relDir);
      for (const child of children) {
        if (entries.length >= maxEntries) return;
        if (child.type === 'dir') {
          stats.dirs += 1;
          entries.push({ path: child.path, type: 'dir', depth: baseDepth + depth });
          if (depth < maxDepth) await walk(path.join(projectDir, child.path), child.path, depth + 1);
        } else {
          stats.files += 1;
          stats.totalBytes += child.size || 0;
          stats.byExt[child.ext || '(none)'] = (stats.byExt[child.ext || '(none)'] || 0) + 1;
          if (TEXT_EXTENSIONS.has(child.ext)) stats.textFiles += 1;
          else stats.binaryFiles += 1;
          entries.push({ path: child.path, type: 'file', ext: child.ext, size: child.size, depth: baseDepth + depth });
        }
      }
    }

    await walk(rootAbs, rel, 0);
    const byExt = Object.entries(stats.byExt).sort((a, b) => b[1] - a[1]).slice(0, 16);
    const content = [
      `范围: /${rel || ''}`,
      `目录: ${stats.dirs}, 文件: ${stats.files}, 文本文件: ${stats.textFiles}, 二进制/资源: ${stats.binaryFiles}, 总大小: ${formatSize(stats.totalBytes)}`,
      `主要扩展名: ${byExt.map(([ext, count]) => `${ext}=${count}`).join(', ') || '(无)'}`,
      '',
      ...entries.map((entry) => `${'  '.repeat(Math.max(0, entry.depth - baseDepth))}${entry.type === 'dir' ? '[dir] ' : '[file]'} ${entry.path}${entry.size ? ` (${formatSize(entry.size)})` : ''}`),
      entries.length >= maxEntries ? `... 已达到 ${maxEntries} 项上限，请缩小 path 或降低 maxDepth。` : '',
    ].filter(Boolean).join('\n');
    return { ok: true, stats, entries, content, summary: `${stats.dirs} 目录 / ${stats.files} 文件` };
  }

  async function findImportantFiles(rel = '', limit = 40, maxFiles = 1200) {
    const rootAbs = rel ? safeResolve(rel) : projectDir;
    if (!rootAbs) return { ok: false, error: `路径无效: ${rel}` };
    const candidates = [];
    const scanLimit = clamp(Number(maxFiles) || 1200, 100, 5000);
    let scanned = 0;
    let capped = false;

    async function walk(absDir, relDir) {
      if (candidates.length > limit * 8 || scanned >= scanLimit) {
        capped = scanned >= scanLimit;
        return;
      }
      const children = await listDir(absDir, relDir);
      for (const child of children) {
        if (candidates.length > limit * 8 || scanned >= scanLimit) {
          capped = scanned >= scanLimit;
          return;
        }
        if (child.type === 'dir') {
          await walk(path.join(projectDir, child.path), child.path);
          continue;
        }
        scanned += 1;
        if (!TEXT_EXTENSIONS.has(child.ext)) continue;
        const score = scoreImportantFile(child);
        if (score > 0) candidates.push({ ...child, score, reason: importantReason(child) });
      }
    }

    await walk(rootAbs, rel);
    candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    const files = candidates.slice(0, limit);
    const content = [
      files.map((file) => `- ${file.path} (${formatSize(file.size)}, score ${file.score}) — ${file.reason}`).join('\n') || '(未发现高置信关键文件)',
      capped ? `\n提示: 扫描已达到 ${scanLimit} 个文件上限，请缩小 path 或提高 maxFiles。` : '',
    ].filter(Boolean).join('\n');
    return { ok: true, files, scanned, capped, content, summary: `${files.length} 个候选关键文件 / 扫描 ${scanned} 文件` };
  }

  async function searchCode(pattern, subPath = '', options = {}) {
    if (!pattern) return { ok: false, error: '未指定搜索模式' };
    const root = subPath ? safeResolve(subPath) : projectDir;
    if (!root) return { ok: false, error: '路径无效' };
    const regex = safeRegex(pattern);
    if (!regex) return { ok: false, error: `无效正则表达式: ${pattern}` };

    const s = strat();
    const limit = clamp(Number(options.limit) || s.searchMaxMatches || 60, 1, Math.max(120, s.searchMaxMatches || 0));
    const maxFiles = clamp(Number(options.maxFiles) || s.searchMaxFiles || 600, 1, Math.max(2000, s.searchMaxFiles || 0));
    const before = clamp(Number(options.before) || 0, 0, 8);
    const after = clamp(Number(options.after) || 0, 0, 8);
    const results = [];
    let searched = 0;

    async function walk(absDir, relDir) {
      if (results.length >= limit || searched >= maxFiles) return;
      const entries = await fsp.readdir(absDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (results.length >= limit || searched >= maxFiles) return;
        if (IGNORED_NAMES.has(entry.name)) continue;
        const abs = path.join(absDir, entry.name);
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(abs, rel);
          continue;
        }
        if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        searched += 1;
        const lines = (await fsp.readFile(abs, 'utf8').catch(() => '')).split(/\r\n|\r|\n/);
        lines.forEach((line, index) => {
          regex.lastIndex = 0;
          if (results.length < limit && regex.test(line)) {
            const from = Math.max(0, index - before);
            const to = Math.min(lines.length - 1, index + after);
            results.push({
              file: rel,
              line: index + 1,
              content: line.trim().slice(0, 220),
              snippet: lines.slice(from, to + 1).map((item, offset) => `${from + offset + 1}: ${item}`).join('\n'),
            });
          }
        });
      }
    }

    await walk(root, subPath || '');
    const content = results.map((item) => (
      before || after
        ? `### ${item.file}:${item.line}\n\`\`\`\n${item.snippet}\n\`\`\``
        : `${item.file}:${item.line}  ${item.content}`
    )).join('\n') || '(未找到匹配结果)';
    return { ok: true, content, results, searched, summary: `${results.length} 处匹配 / 扫描 ${searched} 文件` };
  }

  async function listDirectoryByPath(rel = '') {
    const abs = rel ? safeResolve(rel) : projectDir;
    if (!abs) return { ok: false, error: `路径无效: ${rel}` };
    const children = await listDir(abs, rel);
    return { ok: true, items: children, content: formatDirItems(children), summary: `${children.length} 项` };
  }

  return {
    projectDir,
    projectName,
    safeResolve,
    getTree,
    compactTree,
    countNodes,
    listDirectoryByPath,
    readContext,
    readFilePreview,
    toolReadFile,
    readFileSlice,
    getFileOutline,
    getProjectMap,
    findImportantFiles,
    searchCode,
  };
}

function formatDirItems(children) {
  if (!children.length) return '(空目录)';
  return children.map((child) => `${child.type === 'dir' ? '[dir]' : '[file]'} ${child.name}${child.type === 'file' ? ` (${formatSize(child.size)})` : ''}`).join('\n');
}

function scoreImportantFile(file) {
  let score = 0;
  if (IMPORTANT_NAME_RE.test(file.path)) score += 100;
  if (ENTRY_NAME_RE.test(file.path)) score += 70;
  if (/\/src\//i.test(file.path)) score += 20;
  if (/\/(cli|server|app|core|context|service|services|router|routes|store)\//i.test(file.path)) score += 24;
  if (/README|CHANGELOG|CONTRIBUTING|LICENSE/i.test(file.name)) score += 18;
  if (/\.(json|json5|toml|ya?ml)$/i.test(file.ext)) score += 12;
  if (TEST_NAME_RE.test(file.path)) score -= 30;
  if (file.size > 0 && file.size < 120 * 1024) score += 8;
  if (file.size > 600 * 1024) score -= 30;
  return score;
}

function importantReason(file) {
  if (IMPORTANT_NAME_RE.test(file.path)) return '项目入口、说明或构建配置';
  if (ENTRY_NAME_RE.test(file.path)) return '可能是运行入口或核心装配文件';
  if (/\/(cli|server|app|core|context|service|services|router|routes|store)\//i.test(file.path)) return '位于高价值架构目录';
  if (/\.(json|json5|toml|ya?ml)$/i.test(file.ext)) return '配置文件';
  return '源码结构中的代表性文件';
}

function safeRegex(pattern) {
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
