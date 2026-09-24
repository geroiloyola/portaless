// packages/apw-resolver/src/did-apw/types.ts
//
// Tipos del metodo de DID propio de Portaless: did:apw:<dominio>.
// Distinto de did:plc (AT Protocol, usado por VeraDID) y de did:web
// (W3C, requiere un endpoint HTTPS /.well-known/did.json). did:apw
// reutiliza el mismo TXT record de Protocol APW (_apw.tudominio.com)
// que packages/apw-resolver/src/dns-txt/ y manifest.ts ya implementan --
// sin inventar un mecanismo de publicacion nuevo, sin depender de un
// registro federado de terceros (a diferencia de did:plc, que depende
// de que el servidor PLC de AT Protocol siga existiendo).
//
// Vision de largo plazo (ver ROADMAP.md, seccion "Onboarding de un
// click"): este metodo de DID nace dentro de Portaless, pero esta
// disenado para ser consumido por fuera via un SDK de resolucion
// separado (proyecto aparte, no este repo) -- el mismo patron de
// "asociado oficial, repo propio" que ya se usa para AppPlace/AppLibre.

/** Documento DID, shape compatible con la seccion "verificationMethod"
 * que ya usan did:web y did:plc -- cualquier resolver de DID generico
 * que ya sepa leer un did:web sabe leer este documento sin cambios. */
export interface ApwDidDocument {
  "@context": string[];
  id: string; // "did:apw:tudominio.com"
  verificationMethod: ApwVerificationMethod[];
  assertionMethod: string[]; // referencias a verificationMethod[].id
}

export interface ApwVerificationMethod {
  id: string; // "did:apw:tudominio.com#key-1"
  type: "Ed25519VerificationKey2020";
  controller: string; // mismo valor que ApwDidDocument.id
  publicKeyJwk: JsonWebKey;
}

/** Par de claves recien generado. privateKeyJwk existe SOLO en el
 * momento de generacion -- quien invoca generateApwDid() decide que
 * hacer con ella (mostrarla una vez al usuario, cifrarla, etc.). Este
 * modulo nunca la persiste por cuenta propia. */
export interface ApwKeyPair {
  did: string;
  domain: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  didDocument: ApwDidDocument;
}
