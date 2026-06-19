import fsp from 'node:fs/promises';
import path from 'node:path';

export function createAnalysisStore(analysesDir) {
  const rootAnalysis = path.join(analysesDir, '_root.json');

  function filePath(rel = '') {
    if (!rel) return rootAnalysis;
    const clean = path.normalize(rel).replace(/^([/\\])+/, '');
    const target = path.resolve(analysesDir, `${clean}.json`);
    if (target !== rootAnalysis && !target.startsWith(analysesDir + path.sep)) return null;
    return target;
  }

  async function load(rel) {
    const target = filePath(rel);
    if (!target) return null;
    try {
      return JSON.parse(await fsp.readFile(target, 'utf8'));
    } catch {
      return null;
    }
  }

  async function save(rel, data) {
    const target = filePath(rel);
    if (!target) return;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, JSON.stringify({ path: rel, updated: new Date().toISOString(), ...data }, null, 2), 'utf8');
  }

  async function remove(rel) {
    const target = filePath(rel);
    if (!target) return;
    await fsp.unlink(target).catch(() => {});
  }

  async function migrateLegacyFiles() {
    const entries = await fsp.readdir(analysesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const oldPath = path.join(analysesDir, entry.name);
      const data = await fsp.readFile(oldPath, 'utf8').then(JSON.parse).catch(() => null);
      const nextPath = data ? filePath(data.path || '') : null;
      if (!nextPath || path.resolve(nextPath) === path.resolve(oldPath)) continue;
      await fsp.mkdir(path.dirname(nextPath), { recursive: true });
      await fsp.writeFile(nextPath, JSON.stringify(data, null, 2), 'utf8');
      await fsp.unlink(oldPath).catch(() => {});
      console.log(`  migrated analysis: ${entry.name} -> ${path.relative(analysesDir, nextPath)}`);
    }
  }

  return { load, save, remove, migrateLegacyFiles };
}
