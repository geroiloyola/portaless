// Puente APW <-> AT: confianza del vinculo (also_known_as > self >
// subdomain), candidatos de dominio por sufijo, y el "claim" que publica
// el lado APW en su did:apw via alsoKnownAs. Logica pura, sin red.

import { describe, it, expect } from "vitest";
import {
  linkConfidence,
  findApwLink,
  apwClaimedHandles,
  candidateDomainsForHandle,
  apwAtUri,
} from "../../packages/identity-atproto/src/link";

describe("linkConfidence", () => {
  it("self: el handle ES el dominio del sitio APW", () => {
    expect(linkConfidence("example.com", "example.com")).toBe("self");
  });

  it("subdomain: el handle vive bajo el dominio del sitio (jerarquia DNS)", () => {
    expect(linkConfidence("username.wikipedia.org", "wikipedia.org")).toBe("subdomain");
    expect(linkConfidence("a.b.example.com", "example.com")).toBe("subdomain");
  });

  it("also_known_as: el did:apw del sitio publica el claim explicito", () => {
    const doc = { alsoKnownAs: ["at://editorial.otherdomain.com"] };
    expect(linkConfidence("editorial.otherdomain.com", "example.org", doc)).toBe("also_known_as");
  });

  it("el claim explicito gana sobre la relacion por dominio", () => {
    const doc = { alsoKnownAs: ["at://username.wikipedia.org"] };
    expect(linkConfidence("username.wikipedia.org", "wikipedia.org", doc)).toBe("also_known_as");
  });

  it("sin relacion -> null (sitios APW ajenos no vinculan)", () => {
    expect(linkConfidence("alice.bsky.social", "example.com")).toBeNull();
    expect(linkConfidence("notexample.com", "example.com")).toBeNull();
    expect(linkConfidence("evil-example.com", "example.com")).toBeNull();
  });

  it("alsoKnownAs malformado se ignora (no vincula)", () => {
    expect(linkConfidence("x.com", "y.com", { alsoKnownAs: "at://x.com" })).toBeNull();
    expect(linkConfidence("x.com", "y.com", { alsoKnownAs: ["https://x.com"] })).toBeNull();
  });
});

describe("findApwLink", () => {
  it("elige la mayor confianza", () => {
    const best = findApwLink("username.wikipedia.org", [
      { siteId: "wikipedia.org" },
      { siteId: "username.wikipedia.org" },
    ]);
    expect(best).toEqual({ siteId: "username.wikipedia.org", confidence: "self" });
  });

  it("also_known_as le gana a self/subdomain aunque venga despues en la lista", () => {
    const best = findApwLink("username.wikipedia.org", [
      { siteId: "wikipedia.org", didDocument: { alsoKnownAs: ["at://username.wikipedia.org"] } },
      { siteId: "username.wikipedia.org" },
    ]);
    expect(best).toEqual({ siteId: "wikipedia.org", confidence: "also_known_as" });
  });

  it("sin candidatos vinculados -> null", () => {
    expect(findApwLink("alice.bsky.social", [{ siteId: "example.com" }])).toBeNull();
    expect(findApwLink("alice.bsky.social", [])).toBeNull();
  });
});

describe("apwClaimedHandles", () => {
  it("extrae solo handles validos de alsoKnownAs", () => {
    expect(
      apwClaimedHandles({ alsoKnownAs: ["at://@a.example.com", "at://b.example.com", "at://bad", 42] })
    ).toEqual(["a.example.com", "b.example.com"]);
  });

  it("documento sin el campo -> []", () => {
    expect(apwClaimedHandles(null)).toEqual([]);
    expect(apwClaimedHandles(undefined)).toEqual([]);
    expect(apwClaimedHandles({})).toEqual([]);
  });
});

describe("candidatos y URIs", () => {
  it("candidateDomainsForHandle delega en sufijos validos", () => {
    expect(candidateDomainsForHandle("user.example.com")).toEqual(["user.example.com", "example.com"]);
  });

  it("apwAtUri construye la forma estandar", () => {
    expect(apwAtUri("user.example.com")).toBe("at://user.example.com");
  });
});
