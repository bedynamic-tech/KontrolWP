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

/** True when SITE_SECRETS_KEY decodes to 32 bytes (base64 or base64url). */
export function isValidSecretsKey(value: string | undefined): boolean {
  try {
    return base64UrlDecode(value?.trim() ?? "").length === 32;
  } catch {
    return false;
  }
}

const keys = new Map<string, Promise<CryptoKey>>();

function importKey(value: string | undefined): Promise<CryptoKey> {
  value = value?.trim();
  if (!value || !isValidSecretsKey(value)) throw new SecretsKeyError();
  const raw = base64UrlDecode(value);
  let key = keys.get(value!);
  if (!key) {
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(value!, key);
  }
  return key;
}

export function encryptSecret(keyValue: string | undefined, siteId: number, secret: string): Promise<string> {
  return seal(keyValue, aad(siteId), secret);
}

export function decryptSecret(keyValue: string | undefined, siteId: number, stored: string): Promise<string> {
  return open(keyValue, aad(siteId), stored, UNREADABLE);
}

// Dashboard settings, such as the Umami API key, are bound to their name.
const settingAad = (name: string) => encoder.encode(`presser-setting:${name}`);

export function encryptSetting(keyValue: string | undefined, name: string, secret: string): Promise<string> {
  return seal(keyValue, settingAad(name), secret);
}

export function decryptSetting(keyValue: string | undefined, name: string, stored: string): Promise<string> {
  return open(keyValue, settingAad(name), stored, "Presser could not decrypt a saved setting. If SITE_SECRETS_KEY changed, enter it again in Settings.");
}

async function seal(keyValue: string | undefined, additionalData: Uint8Array, secret: string): Promise<string> {
  const key = await importKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, encoder.encode(secret));
  return [VERSION, base64UrlEncode(iv), base64UrlEncode(new Uint8Array(sealed))].join(".");
}

async function open(keyValue: string | undefined, additionalData: Uint8Array, stored: string, unreadable: string): Promise<string> {
  const key = await importKey(keyValue);
  const [version, iv, sealed] = stored.split(".");
  if (version !== VERSION || !iv || !sealed) throw new SecretsKeyError(unreadable);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(iv), additionalData },
      key,
      base64UrlDecode(sealed),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecretsKeyError(unreadable);
  }
}
