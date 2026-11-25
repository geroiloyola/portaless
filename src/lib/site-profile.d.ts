export type SiteProfileId = "starter" | "demo";

export interface SiteProfileFeatures {
  esRoutes: boolean;
  beta: boolean;
  docs: boolean;
  projections: boolean;
  shop: boolean;
  legacyDemoRedirects: boolean;
  demoAuxiliaryStatic: boolean;
}

export interface SiteProfileConfig {
  id: SiteProfileId;
  isDemo: boolean;
  isStarter: boolean;
  profileDir: string;
  homeFile: string;
  homeEsFile: string | null;
  pagesDir: string;
  postsDir: string;
  publicDir: string;
  features: SiteProfileFeatures;
  defaultSiteName: string;
  defaultSiteDescription: string;
}

export declare const VALID_SITE_PROFILES: readonly SiteProfileId[];
export declare const DEFAULT_SITE_PROFILE: SiteProfileId;
export declare const DEMO_TEMPLATES_DIR: string;

export declare function resolveSiteProfile(
  env?: Record<string, string | undefined>,
): SiteProfileId;

export declare function isDemoProfile(
  env?: Record<string, string | undefined>,
): boolean;

export declare function isStarterProfile(
  env?: Record<string, string | undefined>,
): boolean;

export declare function getSiteProfileConfig(
  profileOrEnv?: SiteProfileId | Record<string, string | undefined>,
): SiteProfileConfig;
