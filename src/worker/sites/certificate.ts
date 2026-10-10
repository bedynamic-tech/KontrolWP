import type { SslCertificate } from "../../shared/types.ts";

/**
 * The TLS certificate a site serves, read without a library. Workers cannot
 * see the certificate behind a fetch, so KontrolWP opens a plain TCP socket,
 * sends a TLS 1.2 ClientHello and reads the Certificate message, which TLS 1.2
 * sends unencrypted. It never finishes the handshake.
 *
 * That fails for servers that only speak TLS 1.3 and for sites behind
 * Cloudflare, which Workers may not open sockets to. Those fall back to the
 * Certificate Transparency logs: every public certificate is logged when it is
 * issued, so the newest valid one for the host is almost always the one served.
 */

const TIMEOUT_MS = 8000;
/** A certificate chain is a few kilobytes; stop reading long before anything unreasonable. */
const MAX_BYTES = 128 * 1024;
const CERT_SPOTTER = "https://api.certspotter.com/v1/issuances";
/** Cert Spotter answers up to this many certificates a request. */
const LOG_PAGE_SIZE = 100;
const LOG_PAGES = 4;

/** The two ends of a TCP connection, as `connect()` from cloudflare:sockets returns them. */
export interface RawSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void> | void;
}
export type OpenSocket = (hostname: string, port: number) => Promise<RawSocket>;

export interface ParsedCertificate {
  subject: string;
  issuer: string;
  valid_from: number;
  expires_at: number;
  names: string[];
}

export class CertificateError extends Error {}

const openWorkerSocket: OpenSocket = async (hostname, port) => {
  const { connect } = await import("cloudflare:sockets");
  const socket = connect({ hostname, port });
  await socket.opened;
  return socket;
};

/**
 * Read the certificate `host` serves, from the server itself when it answers
 * TLS 1.2, else from the Certificate Transparency logs. Never throws: a
 * failure comes back in `error`.
 */
export async function checkCertificate(
  host: string,
  now = Math.floor(Date.now() / 1000),
  options: { open?: OpenSocket; fetcher?: typeof fetch } = {},
): Promise<SslCertificate> {
  const base = { host, checked_at: now };
  let direct: string;
  try {
    const cert = await readServedCertificate(host, options.open ?? openWorkerSocket);
    return { ...base, ...cert, source: "server", covers_host: coversHost(cert.names, host), error: null };
  } catch (error) {
    direct = error instanceof Error ? error.message : String(error);
  }
  try {
    const cert = await readLoggedCertificate(host, now, options.fetcher ?? fetch);
    if (cert) return { ...base, ...cert, source: "ct", covers_host: coversHost(cert.names, host), error: null };
    return emptyCertificate(base, "No valid certificate for this host was found in the public certificate logs.");
  } catch (error) {
    console.error("certificate", host, direct, error);
    return emptyCertificate(base, "The certificate could not be read. KontrolWP will try again tomorrow.");
  }
}

function emptyCertificate(base: { host: string; checked_at: number }, error: string): SslCertificate {
  return {
    ...base,
    source: null,
    subject: "",
    issuer: "",
    valid_from: null,
    expires_at: null,
    names: [],
    covers_host: null,
    error,
  };
}

/** True when one of the certificate's names (an exact host or a one-label wildcard) matches `host`. */
export function coversHost(names: string[], host: string): boolean {
  const target = host.toLowerCase().replace(/\.$/, "");
  return names.some((raw) => {
    const name = raw.toLowerCase();
    if (name === target) return true;
    if (!name.startsWith("*.")) return false;
    const dot = target.indexOf(".");
    return dot > 0 && target.slice(dot + 1) === name.slice(2);
  });
}

// --- TLS 1.2 handshake, up to the server's Certificate message ---

const CIPHER_SUITES = [
  0xc02b, 0xc02f, 0xc02c, 0xc030, 0xcca9, 0xcca8, 0xc009, 0xc013, 0xc00a, 0xc014, 0x009c, 0x009d, 0x002f, 0x0035,
];
const GROUPS = [0x001d, 0x0017, 0x0018];
const SIGNATURES = [0x0403, 0x0804, 0x0401, 0x0503, 0x0805, 0x0501, 0x0806, 0x0601, 0x0201, 0x0203];

const u16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const u24 = (value: number) => [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const list16 = (values: number[]) => values.flatMap(u16);
const extension = (type: number, body: number[]) => [...u16(type), ...u16(body.length), ...body];

/** A TLS 1.2 ClientHello naming `host` (SNI), with the cipher suites and groups servers commonly accept. */
export function clientHello(host: string, random: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): Uint8Array {
  const name = [...new TextEncoder().encode(host)];
  const extensions = [
    ...extension(0x0000, [...u16(name.length + 3), 0, ...u16(name.length), ...name]),
    ...extension(0x000a, [...u16(GROUPS.length * 2), ...list16(GROUPS)]),
    ...extension(0x000b, [1, 0]),
    ...extension(0x000d, [...u16(SIGNATURES.length * 2), ...list16(SIGNATURES)]),
    ...extension(0x0017, []),
    ...extension(0xff01, [0]),
  ];
  const body = [
    0x03, 0x03,
    ...random,
    0,
    ...u16(CIPHER_SUITES.length * 2),
    ...list16(CIPHER_SUITES),
    1, 0,
    ...u16(extensions.length),
    ...extensions,
  ];
  const handshake = [1, ...u24(body.length), ...body];
  return new Uint8Array([0x16, 0x03, 0x01, ...u16(handshake.length), ...handshake]);
}

async function readServedCertificate(host: string, open: OpenSocket): Promise<ParsedCertificate> {
  let socket: RawSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CertificateError("The server did not answer in time")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        socket = await open(host, 443);
        const writer = socket.writable.getWriter();
        await writer.write(clientHello(host));
        writer.releaseLock();
        return parseCertificate(await readCertificateMessage(socket.readable));
      })(),
      timeout,
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    try {
      await (socket as RawSocket | null)?.close();
    } catch {
      // Already closed by the server.
    }
  }
}

/** Read TLS records until the server's first certificate arrives, and return it (DER). */
export async function readCertificateMessage(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  let records: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let handshake: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let total = 0;
  try {
    for (;;) {
      // Handshake messages that have fully arrived.
      let offset = 0;
      while (handshake.length - offset >= 4) {
        const type = handshake[offset];
        const length = (handshake[offset + 1] << 16) | (handshake[offset + 2] << 8) | handshake[offset + 3];
        if (handshake.length - offset - 4 < length) break;
        const body = handshake.subarray(offset + 4, offset + 4 + length);
        if (type === 11) return firstCertificate(body);
        if (type === 14) throw new CertificateError("The server sent no certificate");
        offset += 4 + length;
      }
      handshake = handshake.slice(offset);

      const { value, done } = await reader.read();
      if (done) throw new CertificateError("The server closed the connection");
      total += value.length;
      if (total > MAX_BYTES) throw new CertificateError("The server sent too much data");
      records = concat(records, value);
      // Whole records: 5 byte header, then the fragment.
      while (records.length >= 5) {
        const length = (records[3] << 8) | records[4];
        if (records.length < 5 + length) break;
        const type = records[0];
        const fragment = records.subarray(5, 5 + length);
        if (type === 21) throw new CertificateError("The server refused TLS 1.2");
        if (type !== 22) throw new CertificateError("The server did not answer with a TLS handshake");
        handshake = concat(handshake, fragment);
        records = records.slice(5 + length);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function firstCertificate(body: Uint8Array): Uint8Array {
  // certificate_list<0..2^24-1>, each entry ASN.1Cert<1..2^24-1>.
  if (body.length < 6) throw new CertificateError("The server sent an empty certificate list");
  const length = (body[3] << 16) | (body[4] << 8) | body[5];
  if (!length || body.length < 6 + length) throw new CertificateError("The server sent an empty certificate list");
  return body.slice(6, 6 + length);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

// --- X.509 (DER): only the fields KontrolWP shows ---

interface Der {
  tag: number;
  start: number;
  end: number;
}

function readDer(bytes: Uint8Array, offset: number): Der {
  const tag = bytes[offset];
  let length = bytes[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count < 1 || count > 4) throw new CertificateError("The certificate could not be read");
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + bytes[start + i];
    start += count;
  }
  const end = start + length;
  if (tag === undefined || end > bytes.length) throw new CertificateError("The certificate could not be read");
  return { tag, start, end };
}

function children(bytes: Uint8Array, parent: Der): Der[] {
  const items: Der[] = [];
  for (let offset = parent.start; offset < parent.end; ) {
    const item = readDer(bytes, offset);
    items.push(item);
    offset = item.end;
  }
  return items;
}

const OID_CN = "2.5.4.3";
const OID_ORG = "2.5.4.10";
const OID_SAN = "2.5.29.17";

function oid(bytes: Uint8Array): string {
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let value = 0;
  for (const byte of bytes.subarray(1)) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

function text(bytes: Uint8Array, tag: number): string {
  // BMPString is UTF-16; the others KontrolWP meets are ASCII or UTF-8.
  if (tag === 0x1e) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder().decode(bytes);
}

/** A distinguished name as its common name, or its organization when it has none. */
function nameOf(bytes: Uint8Array, name: Der): string {
  const values = new Map<string, string>();
  for (const set of children(bytes, name)) {
    for (const pair of children(bytes, set)) {
      const [type, value] = children(bytes, pair);
      if (!type || !value) continue;
      const key = oid(bytes.subarray(type.start, type.end));
      if (!values.has(key)) values.set(key, text(bytes.subarray(value.start, value.end), value.tag));
    }
  }
  return values.get(OID_CN) ?? values.get(OID_ORG) ?? "";
}

function time(bytes: Uint8Array, item: Der): number {
  const value = new TextDecoder().decode(bytes.subarray(item.start, item.end));
  const match =
    item.tag === 0x17
      ? /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(value)
      : /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\.\d+)?Z$/.exec(value);
  if (!match) throw new CertificateError("The certificate's dates could not be read");
  let year = Number(match[1]);
  // UTCTime: 50 to 99 are 1950 to 1999 (RFC 5280).
  if (item.tag === 0x17) year += year >= 50 ? 1900 : 2000;
  return Math.floor(
    Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)) / 1000,
  );
}

/** Subject, issuer, validity and DNS names of one DER certificate. */
export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const certificate = readDer(der, 0);
  const [tbs] = children(der, certificate);
  if (!tbs) throw new CertificateError("The certificate could not be read");
  const fields = children(der, tbs);
  // An explicit [0] version comes first in every v3 certificate.
  const base = fields[0]?.tag === 0xa0 ? 1 : 0;
  const issuer = fields[base + 2];
  const validity = fields[base + 3];
  const subject = fields[base + 4];
  if (!issuer || !validity || !subject) throw new CertificateError("The certificate could not be read");
  const [notBefore, notAfter] = children(der, validity);
  if (!notBefore || !notAfter) throw new CertificateError("The certificate's dates could not be read");

  const names: string[] = [];
  const extensions = fields.find((field) => field.tag === 0xa3);
  if (extensions) {
    const [list] = children(der, extensions);
    for (const ext of list ? children(der, list) : []) {
      const parts = children(der, ext);
      if (!parts[0] || oid(der.subarray(parts[0].start, parts[0].end)) !== OID_SAN) continue;
      const octets = parts[parts.length - 1];
      const general = readDer(der, octets.start);
      for (const entry of children(der, general)) {
        // dNSName is [2] IMPLICIT IA5String.
        if (entry.tag === 0x82) names.push(new TextDecoder().decode(der.subarray(entry.start, entry.end)));
      }
    }
  }
  const subjectName = nameOf(der, subject);
  // An old certificate may carry its host only as the subject's common name.
  if (!names.length && subjectName) names.push(subjectName);
  return {
    subject: subjectName,
    issuer: nameOf(der, issuer),
    valid_from: time(der, notBefore),
    expires_at: time(der, notAfter),
    names,
  };
}

// --- Certificate Transparency (Cert Spotter) ---

interface Issuance {
  id?: string;
  dns_names?: string[];
  not_before?: string;
  not_after?: string;
  issuer?: { friendly_name?: string; name?: string };
  revoked?: boolean;
}

/** The newest certificate for `host` in the public logs that is valid now, or null when there is none. */
export async function readLoggedCertificate(
  host: string,
  now: number,
  fetcher: typeof fetch,
): Promise<ParsedCertificate | null> {
  // The log lists oldest first, a page at a time; a host renewed every few weeks for years spans several.
  const issuances: Issuance[] = [];
  let after = "";
  for (let page = 0; page < LOG_PAGES; page++) {
    const query = new URLSearchParams({ domain: host, match_wildcards: "true" });
    query.append("expand", "dns_names");
    query.append("expand", "issuer");
    if (after) query.set("after", after);
    const response = await fetcher(`${CERT_SPOTTER}?${query}`, {
      headers: { Accept: "application/json", "User-Agent": "KontrolWP" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Certificate logs answered HTTP ${response.status}`);
    const batch = (await response.json()) as Issuance[];
    if (!Array.isArray(batch) || !batch.length) break;
    issuances.push(...batch);
    after = batch[batch.length - 1].id ?? "";
    if (!after || batch.length < LOG_PAGE_SIZE) break;
  }
  const valid = issuances
    .map((item) => ({
      item,
      from: Math.floor(Date.parse(item.not_before ?? "") / 1000),
      to: Math.floor(Date.parse(item.not_after ?? "") / 1000),
      names: (item.dns_names ?? []).filter((name) => typeof name === "string"),
    }))
    .filter(({ item, from, to, names }) => !item.revoked && from <= now && to > now && coversHost(names, host))
    // The most recently issued is the one a server that renews on time is serving.
    .sort((a, b) => b.from - a.from);
  const newest = valid[0];
  if (!newest) return null;
  return {
    subject: newest.names.find((name) => coversHost([name], host)) ?? host,
    issuer: newest.item.issuer?.friendly_name || issuerName(newest.item.issuer?.name ?? ""),
    valid_from: newest.from,
    expires_at: newest.to,
    names: newest.names,
  };
}

/** "C=US, O=Let's Encrypt, CN=R11" as "R11", or its organization when it has no common name. */
function issuerName(dn: string): string {
  const parts = Object.fromEntries(
    dn
      .split(/,\s*/)
      .map((part) => part.split("="))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key.trim().toUpperCase(), value.trim()]),
  );
  return parts.CN ?? parts.O ?? dn;
}
