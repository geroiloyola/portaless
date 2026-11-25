// Single source of truth for site profile resolution (W3.3 / W3.5, D8/D11).
//
// Contract (docs/decisions/starter-and-demo-split.md §2):
//   - PORTALESS_SITE_PROFILE=starter|demo
//   - Unset or empty => "starter"
//   - Unknown value => throws (aborts build; never silently falls back to demo)
//
// Locations:
//   - starter => local canonical profile under site-profiles/starter/
//   - demo    => external pinned package @portaless/templates (node_modules/@portaless/templates/demo/)
//                (or PORTALESS_STAGE_PROFILE_DIR for isolated staged exports)

export const VALID_SITE_PROFILES = Object.freeze(["starter", "demo"]);
export const DEFAULT_SITE_PROFILE = "starter";
export const DEMO_TEMPLATES_DIR = "node_modules/@portaless/templates/demo";

/**
 * Resolve and validate PORTALESS_SITE_PROFILE from an environment object.
 * Throws on any non-empty value other than "starter" or "demo".
 */
export function resolveSiteProfile(env = process.env) {
  const raw = env?.PORTALESS_SITE_PROFILE;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_SITE_PROFILE;
  }
  const normalized = String(raw).trim();
  if (normalized === "starter" || normalized === "demo") {
    return normalized;
  }
  throw new Error(
    `Invalid PORTALESS_SITE_PROFILE="${normalized}". Expected "starter" or "demo".`,
  );
}

export function isDemoProfile(env = process.env) {
  return resolveSiteProfile(env) === "demo";
}

export function isStarterProfile(env = process.env) {
  return resolveSiteProfile(env) === "starter";
}

/**
 * Return paths and route feature flags for the resolved site profile.
 */
export function getSiteProfileConfig(profileOrEnv = process.env) {
  const envObj = typeof profileOrEnv === "string" ? process.env : profileOrEnv;
  const id =
    typeof profileOrEnv === "string"
      ? resolveSiteProfile({ PORTALESS_SITE_PROFILE: profileOrEnv })
      : resolveSiteProfile(profileOrEnv);
  const isDemo = id === "demo";
  const profileDir = isDemo ? DEMO_TEMPLATES_DIR : "site-profiles/starter";
  const stageDir =
    typeof envObj?.PORTALESS_STAGE_PROFILE_DIR === "string" &&
    envObj.PORTALESS_STAGE_PROFILE_DIR.trim()
      ? envObj.PORTALESS_STAGE_PROFILE_DIR.trim()
      : null;
  const contentDir = stageDir ?? profileDir;

  return {
    id,
    isDemo,
    isStarter: !isDemo,
    profileDir,
    homeFile: `${profileDir}/home.json`,
    homeEsFile: isDemo ? `${profileDir}/home.es.json` : null,
    pagesDir: `${contentDir}/pages`,
    postsDir: `${contentDir}/posts`,
    publicDir: `${profileDir}/public`,
    features: {
      esRoutes: isDemo,
      beta: isDemo,
      docs: isDemo,
      projections: isDemo,
      shop: isDemo,
      legacyDemoRedirects: isDemo,
      demoAuxiliaryStatic: isDemo,
    },
    defaultSiteName: "Portaless",
    defaultSiteDescription: isDemo
      ? "Sitio construido con Portaless"
      : "A site built with Portaless",
  };
}
