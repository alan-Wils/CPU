/**
 * AWS SDK v3 signing / checksum code paths expect `globalThis.crypto` (Web Crypto).
 * Some Node 18 cloud images omit it; without this, S3/R2 calls throw ReferenceError: crypto is not defined.
 */
import { webcrypto } from "node:crypto";

const g = globalThis as typeof globalThis & { crypto?: Crypto };
if (typeof g.crypto === "undefined") {
  Object.defineProperty(g, "crypto", {
    value: webcrypto,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}
