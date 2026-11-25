import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_PROFILE,
  VALID_SITE_PROFILES,
  getSiteProfileConfig,
  isDemoProfile,
  isStarterProfile,
  resolveSiteProfile,
} from "../../src/lib/site-profile.mjs";

describe("site-profile resolver (W3.3 / PR-B2)", () => {
  it("defaults to starter when PORTALESS_SITE_PROFILE is unset or empty", () => {
    expect(DEFAULT_SITE_PROFILE).toBe("starter");
    expect(VALID_SITE_PROFILES).toEqual(["starter", "demo"]);
    expect(resolveSiteProfile({})).toBe("starter");
    expect(resolveSiteProfile({ PORTALESS_SITE_PROFILE: "" })).toBe("starter");
    expect(resolveSiteProfile({ PORTALESS_SITE_PROFILE: "   " })).toBe("starter");
    expect(isStarterProfile({})).toBe(true);
    expect(isDemoProfile({})).toBe(false);
  });

  it("resolves explicit starter and demo profiles", () => {
    expect(resolveSiteProfile({ PORTALESS_SITE_PROFILE: "starter" })).toBe("starter");
    expect(resolveSiteProfile({ PORTALESS_SITE_PROFILE: "demo" })).toBe("demo");
    expect(isDemoProfile({ PORTALESS_SITE_PROFILE: "demo" })).toBe(true);
    expect(isStarterProfile({ PORTALESS_SITE_PROFILE: "demo" })).toBe(false);
  });

  it("aborts on unknown profile values and never falls back silently to demo", () => {
    expect(() => resolveSiteProfile({ PORTALESS_SITE_PROFILE: "marketing" })).toThrow(
      /Invalid PORTALESS_SITE_PROFILE/,
    );
    expect(() => getSiteProfileConfig("unknown" as never)).toThrow(/Invalid PORTALESS_SITE_PROFILE/);
  });

  it("disables demo-only routes in starter and enables them in demo", () => {
    const starter = getSiteProfileConfig("starter");
    expect(starter.homeFile).toBe("site-profiles/starter/home.json");
    expect(starter.homeEsFile).toBeNull();
    expect(starter.pagesDir).toBe("site-profiles/starter/pages");
    expect(starter.postsDir).toBe("site-profiles/starter/posts");
    expect(starter.features).toEqual({
      esRoutes: false,
      beta: false,
      docs: false,
      projections: false,
      shop: false,
      legacyDemoRedirects: false,
      demoAuxiliaryStatic: false,
    });

    const demo = getSiteProfileConfig("demo");
    expect(demo.homeFile).toBe("node_modules/@portaless/templates/demo/home.json");
    expect(demo.homeEsFile).toBe("node_modules/@portaless/templates/demo/home.es.json");
    expect(demo.pagesDir).toBe("node_modules/@portaless/templates/demo/pages");
    expect(demo.postsDir).toBe("node_modules/@portaless/templates/demo/posts");
    expect(demo.features).toEqual({
      esRoutes: true,
      beta: true,
      docs: true,
      projections: true,
      shop: true,
      legacyDemoRedirects: true,
      demoAuxiliaryStatic: true,
    });
  });
});
