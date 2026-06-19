// 以下为回退默认值；运行时优先采用 config.json / 设置页中的 Agent 策略参数。
export const FILE_MAX_CHARS = 200 * 1024;
export const TOOL_FILE_MAX = 200 * 1024;
export const FILE_PREVIEW_MAX = 600 * 1024;

export const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'build',
  'target',
  'oh_modules',
]);

export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg']);
export const BINARY_EXTENSIONS = new Set([
  '.jar',
  '.whl',
  '.zip',
  '.lock',
  '.so',
  '.dll',
  '.exe',
  '.bin',
  '.woff',
  '.woff2',
  '.ttf',
  '.class',
  '.pyc',
]);

export const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.ets',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.sh',
  '.bat',
  '.java',
  '.kt',
  '.rs',
  '.go',
  '.vue',
  '.jsx',
  '.md',
  '.txt',
  '.json',
  '.json5',
  '.toml',
  '.yml',
  '.yaml',
  '.xml',
  '.html',
  '.css',
  '.sql',
  '.ini',
  '.cfg',
  '.gradle',
]);

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
};

export const EXTENSION_LABELS = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript (ESM)',
  '.cjs': 'JavaScript (CJS)',
  '.py': 'Python',
  '.ets': 'ArkTS',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.json5': 'JSON5',
  '.toml': 'TOML',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.xml': 'XML',
  '.svg': 'SVG',
  '.txt': 'Text',
  '.css': 'CSS',
  '.html': 'HTML',
  '.sh': 'Shell',
  '.bat': 'Batch',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.gradle': 'Groovy',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rs': 'Rust',
  '.go': 'Go',
  '.vue': 'Vue',
  '.jsx': 'React JSX',
  '.sql': 'SQL',
};

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
