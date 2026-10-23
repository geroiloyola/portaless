// CC BY 4.0. Lint specification links, not runtime paths quoted as historical prose.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function violations(text) {
  let appendix = false;
  const found = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (/^#{1,2} /.test(line)) appendix = /^## (?:Apéndice|Appendix).*implementación de referencia/i.test(line);
    if (appendix) continue;
    const targets = [
      ...line.matchAll(/\]\(\s*<?([^\s)>]+)/g),
      ...line.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)/g),
      ...line.matchAll(/(?:href|src)\s*=\s*["']([^"']+)/gi),
      ...line.matchAll(/<(https?:\/\/[^>]+)>/g),
    ];
    for (const target of targets) {
      let path = target[1];
      try { path = decodeURIComponent(path); } catch { /* malformed links fail other lint */ }
      if (/(?:^|\/)(?:functions|packages|src)\//i.test(path.replaceAll('\\', '/'))) found.push(index + 1);
    }
  }
  return found;
}

export function checkTree(root) {
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.venv', '__pycache__'].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) for (const line of violations(readFileSync(path, 'utf8'))) errors.push(`${relative(root, path)}:${line}`);
    }
  }
  walk(root);
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkTree(fileURLToPath(new URL('../', import.meta.url)));
  if (errors.length) throw new Error(`Runtime links outside implementación de referencia appendix:\n${errors.join('\n')}`);
}
