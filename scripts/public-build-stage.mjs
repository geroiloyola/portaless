import fs from "node:fs";
import path from "node:path";

// The build context is an allowlist: code and public assets needed by Astro,
// plus filtered content copied by dedicated functions below. It is not a clone
// of the private node and must never inherit unknown root files.
const ROOT_BUILD_FILES = ["package.json", "package-lock.json", "astro.config.mjs"];
const ROOT_BUILD_DIRS = ["src", "public"];
const PACKAGE_BUILD_DIRS = ["src", "astro-integration"];
const BUILD_ENV_KEYS = [
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "CI",
  "PORTALESS_BASE_PATH", "PORTALESS_SITE_URL", "PORTALESS_SITE_NAME",
  "PORTALESS_SITE_DESCRIPTION", "SITE_LANG", "ENABLE_COMMERCE",
];
const EXCLUDED_COMPONENTS = new Set([
  ".git", ".airchive", ".kilo", ".astro", ".playwright", "node_modules", "dist",
  "coverage", "test-results", "playwright-report", "blob-report", "data", "backups",
  ".ssh", ".aws", ".gnupg", "__tests__", "fixtures", "examples", "docs",
]);
const PRIVATE_FILE_PATTERNS = [
  /^\.env(?:\..+)?$/i,
  /^portaless-secrets\.json$/i,
  /^setup_code\.txt$/i,
  /^credentials\.json$/i,
  /^service-account.*\.json$/i,
  /^config\.json$/i,
  /^\.npmrc$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/i,
  /^.*\.(?:secret|token)$/i,
  /^.*\.(?:db|sqlite|sqlite3)(?:[-.].*)?$/i,
  /^.*\.(?:pem|key|p12|pfx|crt)$/i,
];

function normalized(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function hasPrivatePathComponent(relativePath) {
  const value = normalized(relativePath);
  const components = value.split("/").filter(Boolean);
  if (components.some((component) => EXCLUDED_COMPONENTS.has(component))) return true;
  if (components.some((component) => PRIVATE_FILE_PATTERNS.some((pattern) => pattern.test(component)))) return true;
  return false;
}

/** A shared deny filter for private/runtime names and canonical content inputs. */
export function isExcludedFromPublicBuild(relativePath) {
  const value = normalized(relativePath);
  if (hasPrivatePathComponent(value)) return true;
  return value === "src/content/pages" || value.startsWith("src/content/pages/") ||
    value === "src/content/posts" || value.startsWith("src/content/posts/");
}

function copyTree(sourceRoot, destinationRoot, relativeRoot, { children, allowFile } = {}) {
  const source = path.join(sourceRoot, relativeRoot);
  if (!fs.existsSync(source)) return;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) throw new Error(`Se esperaba directorio de build: ${relativeRoot}`);
  fs.mkdirSync(path.join(destinationRoot, relativeRoot), { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const relative = path.posix.join(normalized(relativeRoot), entry.name);
    if (isExcludedFromPublicBuild(relative)) continue;
    if (children && !children.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destinationRoot, relative);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copyTree(sourceRoot, destinationRoot, relative, { allowFile });
    } else if (entry.isFile() && (!allowFile || allowFile(relative))) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
  }
}

/** Create a minimal Astro build tree from explicit code roots only. */
export function copyPublicBuildInputs(projectRoot, stageRoot) {
  fs.mkdirSync(stageRoot, { recursive: true });
  for (const filename of ROOT_BUILD_FILES) {
    const source = path.join(projectRoot, filename);
    if (!fs.existsSync(source)) throw new Error(`Falta un input requerido para el build público: ${filename}`);
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`No se aceptan symlinks en inputs de build: ${filename}`);
    fs.copyFileSync(source, path.join(stageRoot, filename), fs.constants.COPYFILE_EXCL);
  }

  for (const root of ROOT_BUILD_DIRS) copyTree(projectRoot, stageRoot, root);

  const packagesRoot = path.join(projectRoot, "packages");
  if (!fs.existsSync(packagesRoot)) throw new Error("Falta packages/ para el build Astro.");
  for (const entry of fs.readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const packageName = entry.name;
    const packageRelative = path.posix.join("packages", packageName);
    const packageSource = path.join(projectRoot, packageRelative);
    const packageTarget = path.join(stageRoot, packageRelative);
    fs.mkdirSync(packageTarget, { recursive: true });
    const packageJson = path.join(packageSource, "package.json");
    if (fs.existsSync(packageJson) && !fs.lstatSync(packageJson).isSymbolicLink()) {
      fs.copyFileSync(packageJson, path.join(packageTarget, "package.json"), fs.constants.COPYFILE_EXCL);
    }
    for (const child of PACKAGE_BUILD_DIRS) {
      const childPath = path.join(packageSource, child);
      if (fs.existsSync(childPath) && fs.lstatSync(childPath).isDirectory()) {
        copyTree(projectRoot, stageRoot, path.posix.join(packageRelative, child));
      }
    }
    // The commerce host bridge reads this manifest at build time; package
    // examples/manifests are intentionally not part of the build context.
    if (packageName === "commerce-plugin") {
      const manifest = path.join(packageSource, "manifest.json");
      if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(packageTarget, "manifest.json"), fs.constants.COPYFILE_EXCL);
    }
  }
}

/** Forward only build settings that are intentionally public or operational. */
export function createPublicBuildEnv(sourceEnv, distDir) {
  const env = {};
  for (const key of BUILD_ENV_KEYS) {
    if (typeof sourceEnv[key] === "string") env[key] = sourceEnv[key];
  }
  // Astro makes PUBLIC_* values available to client bundles by contract.
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (key.startsWith("PUBLIC_") && typeof value === "string") env[key] = value;
  }
  env.PORTALESS_OUT_DIR = distDir;
  return env;
}

function pageFileIdentity(filename) {
  const base = filename.replace(/\.json$/i, "");
  const match = /^(.*)\.(en|es)$/.exec(base);
  return match ? { slug: match[1], locale: match[2] } : { slug: base, locale: null };
}

/** Copy published source pages/translations, excluding DB-owned private slugs. */
export function copyPublicSourcePages(projectRoot, stageRoot, blockedSlugs, isPubliclyPublishable) {
  const sourceDir = path.join(projectRoot, "src", "content", "pages");
  if (!fs.existsSync(sourceDir)) return;
  if (fs.lstatSync(sourceDir).isSymbolicLink()) throw new Error("src/content/pages no puede ser un symlink en la exportación pública.");
  const groups = new Map();

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.toLowerCase().endsWith(".json")) continue;
    const layout = JSON.parse(fs.readFileSync(path.join(sourceDir, entry.name), "utf8"));
    const identity = pageFileIdentity(entry.name);
    const group = groups.get(identity.slug) ?? { primary: null, translations: [] };
    const version = { filename: entry.name, layout };
    if (identity.locale === null) group.primary = version;
    else group.translations.push(version);
    groups.set(identity.slug, group);
  }

  const targetDir = path.join(stageRoot, "src", "content", "pages");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [slug, group] of groups) {
    if (
      blockedSlugs.has(slug) || blockedSlugs.has(group.primary?.layout?.slug) ||
      !group.primary || !isPubliclyPublishable(group.primary.layout)
    ) continue;
    const versions = [group.primary, ...group.translations.filter((entry) => isPubliclyPublishable(entry.layout))];
    for (const version of versions) {
      fs.writeFileSync(path.join(targetDir, version.filename), JSON.stringify(version.layout, null, 2), { flag: "wx" });
    }
  }
}

function postIsPublic(source, relativePath, isPubliclyPublishable) {
  const id = relativePath.replace(/\.(?:md|mdx)$/i, "").split(path.sep).join("/");
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Post sin frontmatter válido; exportación fail-closed: ${relativePath}`);
  const metadata = {};
  for (const key of ["draft", "private"]) {
    const found = match[1].match(new RegExp(`^\\s*${key}\\s*:\\s*(true|false)\\s*$`, "im"));
    if (found) metadata[key] = found[1].toLowerCase() === "true";
    else if (new RegExp(`^\\s*${key}\\s*:` , "im").test(match[1])) {
      throw new Error(`Flag ${key} no booleana; exportación fail-closed: ${relativePath}`);
    }
  }
  return isPubliclyPublishable({
    slug: id,
    draft: metadata.draft,
    visibility: metadata.private ? "private" : "public",
  });
}

/** Copy only public Markdown posts; draft/private files never enter staging. */
export function copyPublicSourcePosts(projectRoot, stageRoot, isPubliclyPublishable) {
  const sourceRoot = path.join(projectRoot, "src", "content", "posts");
  if (!fs.existsSync(sourceRoot)) return;
  if (fs.lstatSync(sourceRoot).isSymbolicLink()) throw new Error("src/content/posts no puede ser un symlink en la exportación pública.");
  const targetRoot = path.join(stageRoot, "src", "content", "posts");
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const source = path.join(directory, entry.name);
      const relative = path.relative(sourceRoot, source);
      const combined = path.posix.join("src/content/posts", normalized(relative));
      if (hasPrivatePathComponent(combined)) continue;
      if (entry.isDirectory()) walk(source);
      else if (entry.isFile() && /\.(?:md|mdx)$/i.test(entry.name)) {
        const contents = fs.readFileSync(source, "utf8");
        if (!postIsPublic(contents, relative, isPubliclyPublishable)) continue;
        const destination = path.join(targetRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, contents, { flag: "wx" });
      }
    }
  }
  walk(sourceRoot);
}

/** Copy only docs listed in the public docs navigation. */
export function copyPublicDocs(projectRoot, stageRoot, docEntries) {
  for (const entry of docEntries) {
    if (typeof entry?.file !== "string" || !entry.file.startsWith("docs/") || entry.file.split("/").includes("..")) {
      throw new Error("Entrada de documentación fuera de allowlist.");
    }
    const source = path.join(projectRoot, entry.file);
    const relative = path.relative(projectRoot, source);
    let cursor = projectRoot;
    for (const component of relative.split(path.sep)) {
      cursor = path.join(cursor, component);
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink no permitido en doc público: ${entry.file}`);
    }
    const destination = path.join(stageRoot, entry.file);
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) {
      throw new Error(`Falta documento público declarado en docs-nav: ${entry.file}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

/** Replace staged pages with PageStore layouts approved for publication. */
export function writePublicPageLayouts(stageRoot, layouts, { clear = true } = {}) {
  const pagesDir = path.join(stageRoot, "src", "content", "pages");
  if (clear) fs.rmSync(pagesDir, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });

  for (const layout of layouts) {
    if (typeof layout?.slug !== "string" || !layout.slug.trim()) {
      throw new Error("No se puede exportar una pagina sin slug valido.");
    }
    const destination = path.resolve(pagesDir, `${layout.slug}.json`);
    if (!destination.startsWith(`${path.resolve(pagesDir)}${path.sep}`)) {
      throw new Error(`Slug de pagina fuera del directorio permitido: ${layout.slug}`);
    }
    fs.writeFileSync(destination, JSON.stringify(layout, null, 2));
  }
}
