// Hashing de contrasenas usando scrypt del modulo nativo "node:crypto" --
// deliberadamente NO se usa una libreria externa como bcrypt/argon2 para
// evitar dependencias nativas que requieran compilacion (node-gyp), algo
// que complica despliegues self-hosted simples. scrypt es parte del
// estandar de Node desde la v10 y es resistente a ataques por hardware
// especializado (ASIC/GPU) gracias a su alto costo de memoria.
//
// Si en el futuro este proyecto necesita hashing mas configurable o
// migra a un entorno donde argon2 sea mas facil de instalar, sustituir
// esta implementacion sin cambiar la interfaz publica (hashPassword /
// verifyPassword) hacia el resto del sistema.

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST_N = 16384; // 2^14 -- balance razonable de seguridad/latencia para login interactivo.

export function hashPassword(plainPassword: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(plainPassword, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST_N });
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const derived = scryptSync(plainPassword, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST_N });

  // timingSafeEqual evita que un atacante infiera el hash correcto
  // midiendo cuanto tarda la comparacion (ataque de temporizacion).
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
