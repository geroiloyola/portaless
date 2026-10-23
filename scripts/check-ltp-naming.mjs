// Editorial CI lint only. Does not parse or rewrite signed artifacts.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function fileClass(path) {
  if (/_es\.md$/.test(path) || /^docs\/(?:roadmap|whitepaper)\//.test(path)
    || /^docs\/protocol-apw\/(?:APW-SPEC-v1\.[02]|apw-spec)\.md$/.test(path)) return 'history';
  if (/^docs\/protocol-apw\/(?:vectors|schemas)\/.+\.(?:json|jws|bin|wire)$/.test(path)) return 'protected-bytes';
  return 'live';
}

export function violations(path, text) {
  if (fileClass(path) !== 'live') return [];
  const errors = [];
  let marked = null, versionHistory = false, releasedChangelog = false;
  for (const [offset, line] of text.split('\n').entries()) {
    const at = offset + 1;
    const marker = line.match(/^<!-- ltp-(continuity|history):(start|end) -->$/);
    if (marker) {
      if (marker[2] === 'start') {
        if (marked) errors.push(`${path}:${at}: nested naming exception`);
        marked = marker[1];
      } else {
        if (marked !== marker[1]) errors.push(`${path}:${at}: unmatched naming exception`);
        marked = null;
      }
      continue;
    }
    if (marked) continue;
    if (path === 'CHANGELOG.md' && /^## v[0-9]/.test(line)) releasedChangelog = true;
    if (releasedChangelog) continue;
    if (path === 'docs/protocol-apw/APW-SPEC-v1.3.md' && line === '**Version history**') versionHistory = true;
    if (versionHistory && (/^---$/.test(line) || /^## /.test(line))) versionHistory = false;
    if (versionHistory) continue;
    const plain = line.replace(/[*_`"']/g, '');
    for (const match of plain.matchAll(/\b([A-Za-z][A-Za-z-]*)\s+Trust\s+Protocol\b/g)) {
      if (match[1] !== 'Local') errors.push(`${path}:${at}: noncanonical Trust Protocol expansion`);
    }
    // Detect other named expansions too, not just the two retired Trust names.
    const assignments = /\bLTP\s*(?:=\s*|\(\s*|\|\s*|(?:means|stands for|significa)\s+)(?:the\s+)?([A-Za-z]+(?:[ \t]+[A-Za-z]+){0,5}[ \t]+Protocol)\b/g;
    for (const match of plain.matchAll(assignments)) {
      if (match[1] !== 'Local Trust Protocol') errors.push(`${path}:${at}: noncanonical LTP expansion`);
    }
    for (const match of plain.matchAll(/\b([A-Z][A-Za-z-]+(?:[ \t]+[A-Z][A-Za-z-]+){0,4}[ \t]+Protocol)\s*\(\s*LTP\s*\)/g)) {
      if (!match[1].endsWith('Local Trust Protocol')) errors.push(`${path}:${at}: noncanonical expanded name before LTP`);
    }
  }
  if (marked) errors.push(`${path}: unclosed naming exception`);
  return errors;
}

export function checkTree(root) {
  const errors = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.venv', '__pycache__'].includes(entry.name)) continue;
      const full = resolve(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const path = relative(root, full).replaceAll('\\', '/');
      const scoped = /^docs\//.test(path) || /^(?:src|public)\//.test(path)
        || /^packages\/.*\/README[^/]*$/i.test(path)
        || /^(?:README.*|AGENT.*|CHANGELOG.*|ROADMAP.*)\.md$/.test(path);
      if (!scoped || !/\.(?:md|astro|ts|js|mjs|txt|html|json|css|svg|xml|webmanifest)$/.test(path)) continue;
      errors.push(...violations(path, readFileSync(full, 'utf8')));
    }
  }
  // Scope traversal as well as matching: generated artifacts/dependencies are not documentation.
  for (const name of ['docs', 'src', 'public', 'packages']) walk(resolve(root, name));
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:README.*|AGENT.*|CHANGELOG.*|ROADMAP.*)\.md$/.test(entry.name)) {
      errors.push(...violations(entry.name, readFileSync(resolve(root, entry.name), 'utf8')));
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkTree(fileURLToPath(new URL('../', import.meta.url)));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Live LTP expansions are canonical; classified history and signed artifacts are preserved.');
}
