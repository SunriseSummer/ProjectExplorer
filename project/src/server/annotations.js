export async function loadAnnotations(projectName) {
  try {
    const mod = await import('../../lib/annotations.js');
    const annotations = mod.default || {};
    const root = annotations[''];
    if (root?.title && projectName.toLowerCase() !== 'hometrans') {
      const title = root.title.toLowerCase();
      if (!title.includes(projectName.toLowerCase())) delete annotations[''];
    }
    return annotations;
  } catch {
    return {};
  }
}
