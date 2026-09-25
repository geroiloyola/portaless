// packages/apw-resolver/src/did-apw/index.ts
//
// Punto de entrada del metodo de DID propio did:apw. Ver types.ts para
// el razonamiento de diseño completo (por que existe, en que se
// diferencia de did:plc/did:web, y la vision de SDK externo futuro).

export { generateApwDid } from "./generate";
export { buildDidDocument, parseApwDidDocument } from "./document";
export type { ApwDidDocument, ApwVerificationMethod, ApwKeyPair } from "./types";
