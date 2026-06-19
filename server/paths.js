import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
export const PROJECT_DIR = path.resolve(
  process.env.PROJECT_DIR || process.env.HOMETRANS_DIR || path.join(ROOT_DIR, 'project'),
);
export const PROJECT_NAME = path.basename(PROJECT_DIR);
export const ANALYSES_DIR = path.join(ROOT_DIR, 'analyses', PROJECT_NAME);
export const PORT = Number(process.env.PORT) || 5173;
