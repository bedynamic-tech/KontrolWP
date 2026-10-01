import type { DnsRecord, DomainRegistration, SiteDomain } from "../shared/types.ts";

/**
 * A site's domain from public sources, read live: DNS records over
 * Cloudflare's DNS-over-HTTPS, and registration from the registry's RDAP
 * service (the successor to WHOIS), found through IANA's bootstrap file.
 * Nothing is stored and no API key is needed.
 */

const DOH = "https://cloudflare-dns.com/dns-query";
const RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";

const DNS_TYPES: Record<number, DnsRecord["type"]> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  257: "CAA",
};

/** Records asked for at the registered domain, and at the site's own host when that differs. */
const APEX_TYPES: DnsRecord["type"][] = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA"];
const HOST_TYPES: DnsRecord["type"][] = ["CNAME", "A", "AAAA"];

export async function lookupDomain(siteUrl: string, now = Date.now()): Promise<SiteDomain> {
  const host = new URL(siteUrl).hostname.toLowerCase().replace(/\.$/, "");
  const registration = await lookupRegistration(host).catch((error: unknown) => ({
    domain: guessDomain(host),
    registration: null,
    error: error instanceof Error ? error.message : String(error),
  }));
  const domain = registration.domain;
  const names: [string, DnsRecord["type"][]][] = [[domain, APEX_TYPES]];
  if (host !== domain) names.push([host, HOST_TYPES]);
  const lookups = await Promise.all(
    names.flatMap(([name, types]) => types.map((type) => resolve(name, type).catch(() => null))),
  );
  const failed = lookups.filter((records) => records === null).length;
  return {
    domain,
    host,
    registration: registration.registration,
    registration_error: registration.error,
    dns: dedupe(lookups.flatMap((records) => records ?? [])),
    dns_error: failed === lookups.length ? "DNS could not be read. Try again in a moment." : null,
    checked_at: Math.floor(now / 1000),
  };
}

/** One DNS-over-HTTPS query, in the JSON form Cloudflare's resolver answers. */
async function resolve(name: string, type: DnsRecord["type"]): Promise<DnsRecord[]> {
  const url = `${DOH}?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!response.ok) throw new Error(`DNS lookup failed (HTTP ${response.status})`);
  const body = (await response.json()) as { Answer?: { name: string; type: number; TTL: number; data: string }[] };
  return (body.Answer ?? []).flatMap((answer) => {
    const recordType = DNS_TYPES[answer.type];
    // A CNAME query also returns the target's records; keep each type to its own query.
    if (!recordType || recordType !== type) return [];
    return [{ type: recordType, name: answer.name.replace(/\.$/, ""), value: dnsValue(recordType, answer.data), ttl: answer.TTL }];
  });
}

function dnsValue(type: DnsRecord["type"], data: string): string {
  if (type === "TXT") {
    // TXT data arrives as one or more quoted strings that make one value.
    const parts = data.match(/"((?:[^"\\]|\\.)*)"/g);
    return parts ? parts.map((part) => part.slice(1, -1).replace(/\\(.)/g, "$1")).join("") : data;
  }
  return data.replace(/\.$/, "");
}

function dedupe(records: DnsRecord[]): DnsRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.type} ${record.name} ${record.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Without a public-suffix list: the host without "www.", as a first guess. */
function guessDomain(host: string): string {
  return host.replace(/^www\./, "");
}

type RegistrationResult = { domain: string; registration: DomainRegistration | null; error: string | null };

/**
 * Ask the registry's RDAP service, starting from the host and dropping a
 * label at a time until the registry knows the name (www.example.co.uk,
 * then example.co.uk).
 */
async function lookupRegistration(host: string): Promise<RegistrationResult> {
  const labels = guessDomain(host).split(".");
  const tld = labels[labels.length - 1];
  const server = await rdapServer(tld);
  if (!server) {
    return {
      domain: guessDomain(host),
      registration: null,
      error: `The .${tld} registry doesn't publish registration details KontrolWP can read.`,
    };
  }
  for (let start = 0; labels.length - start >= 2; start++) {
    const candidate = labels.slice(start).join(".");
    const response = await fetch(`${server}domain/${encodeURIComponent(candidate)}`, {
      headers: { Accept: "application/rdap+json" },
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`The registry did not answer (HTTP ${response.status}).`);
    return { domain: candidate, registration: parseRdap(await response.json()), error: null };
  }
  return { domain: guessDomain(host), registration: null, error: "The registry has no record of this domain." };
}

/** The RDAP base URL for a TLD from IANA's bootstrap file, cached for a day where the Cache API exists. */
async function rdapServer(tld: string): Promise<string | null> {
  const cache = typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
  let response = cache ? await cache.match(RDAP_BOOTSTRAP) : undefined;
  if (!response) {
    response = await fetch(RDAP_BOOTSTRAP);
    if (!response.ok) throw new Error(`The registry list could not be read (HTTP ${response.status}).`);
    if (cache) {
      const copy = new Response(response.clone().body, response);
      copy.headers.set("Cache-Control", "max-age=86400");
      await cache.put(RDAP_BOOTSTRAP, copy).catch(() => undefined);
    }
  }
  const bootstrap = (await response.json()) as { services: [string[], string[]][] };
  const service = bootstrap.services.find(([tlds]) => tlds.some((entry) => entry.toLowerCase() === tld));
  const url = service?.[1].find((base) => base.startsWith("https://")) ?? service?.[1][0];
  return url ? (url.endsWith("/") ? url : `${url}/`) : null;
}

type RdapEntity = { roles?: string[]; vcardArray?: [string, [string, unknown, string, unknown][]]; entities?: RdapEntity[] };

interface RdapDomain {
  ldhName?: string;
  status?: string[];
  events?: { eventAction: string; eventDate: string }[];
  nameservers?: { ldhName?: string }[];
  secureDNS?: { delegationSigned?: boolean };
  entities?: RdapEntity[];
}

export function parseRdap(body: RdapDomain): DomainRegistration {
  const event = (action: string) => {
    const date = body.events?.find((e) => e.eventAction === action)?.eventDate;
    const time = date ? Date.parse(date) : Number.NaN;
    return Number.isNaN(time) ? null : Math.floor(time / 1000);
  };
  const registrar = body.entities?.find((entity) => entity.roles?.includes("registrar"));
  return {
    registrar: registrar ? vcardName(registrar) : null,
    registered_at: event("registration"),
    updated_at: event("last changed"),
    expires_at: event("expiration"),
    statuses: body.status ?? [],
    nameservers: (body.nameservers ?? []).flatMap((ns) => (ns.ldhName ? [ns.ldhName.toLowerCase().replace(/\.$/, "")] : [])),
    dnssec: typeof body.secureDNS?.delegationSigned === "boolean" ? body.secureDNS.delegationSigned : null,
  };
}

function vcardName(entity: RdapEntity): string | null {
  const fn = entity.vcardArray?.[1]?.find((field) => field[0] === "fn")?.[3];
  return typeof fn === "string" && fn.trim() ? fn.trim() : null;
}
