import { base64UrlDecode, base64UrlEncode } from "../../shared/protocol.ts";

/**
 * Site secrets are stored in D1 encrypted with AES-256-GCM under the
 * SITE_SECRETS_KEY Worker secret, so a copy of the database alone cannot sign
 * requests to any site. scripts/deploy.mjs creates the key on first deploy and
 * never replaces it: losing it means every site needs a new Connection Key.
 */

const VERSION = "v1";
const encoder = new TextEncoder();
// Binds each ciphertext to its site, so rows cannot be swapped between sites.
const aad = (siteId: number) => encoder.encode(`presser-site-secret:${siteId}`);

export class SecretsKeyError extends Error {
  constructor(
    message = "SITE_SECRETS_KEY is missing or invalid. Redeploy with npm run deploy to create it.",
  ) {
    super(message);
  }
}

const UNREADABLE =
  "Presser could not decrypt this site's secret. If SITE_SECRETS_KEY changed, create a new connection key for the site.";

const keys = new Map<string, Promise<CryptoKey>>();

function importKey(value: string | undefined): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64UrlDecode(value ?? "");
  } catch {
    throw new SecretsKeyError();
  }
  if (raw.length !== 32) throw new SecretsKeyError();
  let key = keys.get(value!);
  if (!key) {
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(value!, key);
  }
  return key;
}

export async function encryptSecret(keyValue: string | undefined, siteId: number, secret: string): Promise<string> {
  const key = await importKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(siteId) },
    key,
    encoder.encode(secret),
  );
  return [VERSION, base64UrlEncode(iv), base64UrlEncode(new Uint8Array(sealed))].join(".");
}

export async function decryptSecret(keyValue: string | undefined, siteId: number, stored: string): Promise<string> {
  const key = await importKey(keyValue);
  const [version, iv, sealed] = stored.split(".");
  if (version !== VERSION || !iv || !sealed) throw new SecretsKeyError(UNREADABLE);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(iv), additionalData: aad(siteId) },
      key,
      base64UrlDecode(sealed),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecretsKeyError(UNREADABLE);
  }
}
