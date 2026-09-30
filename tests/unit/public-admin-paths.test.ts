import { describe, expect, it } from "vitest";
import { isPublicAdminPath } from "../../packages/auth/src/public-admin-paths.ts";

describe("isPublicAdminPath", () => {
  it.each([
    "/admin/login", "/admin/login/", "/admin/login-mfa", "/admin/password-reset",
    "/admin/password-reset/request", "/admin/password-reset/confirm",
    "/admin/oauth/github/start", "/admin/oauth/github/callback", "/admin/oauth/google/callback/",
  ])("permite %s", (path) => expect(isPublicAdminPath(path)).toBe(true));

  it.each([
    "/admin", "/admin/", "/admin/editor", "/admin/permissions", "/admin/security",
    "/admin/wizard", "/admin/wizard/step-5-admin-credentials", "/admin/api/wizard/admin-status",
    "/admin/api/oauth/github/callback", "/admin/api/users",
  ])("protege %s", (path) => expect(isPublicAdminPath(path)).toBe(false));

  it.each([
    "/admin/loginx", "/admin/login-mfa-x", "/admin/login/extra", "/admin/logi",
    "/admin/password-reset/../editor", "/admin/login/..", "/admin/./login",
    "/admin/password-reset/%2e%2e/editor", "/admin/login%2F", "/admin//login", "/admin\\login",
    "/admin/oauth/../editor/start", "/admin/oauth/GitHub/start", "/admin/oauth/github/start/extra",
    "/admin/oauth//start", "/admin/oauth/a_b/start", "/admin/oauth/" + "a".repeat(33) + "/start",
    "/ADMIN/LOGIN", "", "/admin/login" + "/".repeat(300),
  ])("rechaza bypass %s", (path) => expect(isPublicAdminPath(path)).toBe(false));
});
