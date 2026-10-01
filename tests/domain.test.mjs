import assert from "node:assert/strict";
import test from "node:test";
import { lookupDomain } from "../src/worker/domain.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const bootstrap = {
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["uk"], ["https://rdap.nominet.uk/uk/"]],
  ],
};

const rdapBody = {
  objectClassName: "domain",
  ldhName: "EXAMPLE.CO.UK",
  status: ["client transfer prohibited", "active"],
  events: [
    { eventAction: "registration", eventDate: "2010-04-01T00:00:00Z" },
    { eventAction: "expiration", eventDate: "2030-04-01T00:00:00Z" },
    { eventAction: "last changed", eventDate: "2026-03-15T12:00:00Z" },
  ],
  nameservers: [{ ldhName: "NS1.EXAMPLE-DNS.COM." }, { ldhName: "ns2.example-dns.com" }],
  secureDNS: { delegationSigned: false },
  entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar Ltd"]]] }],
};

/** Answers DoH and RDAP like the real services, for www.example.co.uk. */
function stub() {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u.href);
    if (u.href === "https://data.iana.org/rdap/dns.json") return json(bootstrap);
    if (u.host === "rdap.nominet.uk") {
      return u.pathname.endsWith("/domain/example.co.uk") ? json(rdapBody) : json({ errorCode: 404 }, 404);
    }
    if (u.host === "cloudflare-dns.com") {
      const name = u.searchParams.get("name");
      const type = u.searchParams.get("type");
      const answers = {
        "example.co.uk A": [{ name: "example.co.uk.", type: 1, TTL: 300, data: "192.0.2.10" }],
        "example.co.uk MX": [{ name: "example.co.uk.", type: 15, TTL: 3600, data: "10 mail.example.co.uk." }],
        "example.co.uk TXT": [{ name: "example.co.uk.", type: 16, TTL: 300, data: '"v=spf1 include:_spf.example.com " "~all"' }],
        "example.co.uk NS": [{ name: "example.co.uk.", type: 2, TTL: 86400, data: "ns1.example-dns.com." }],
        "www.example.co.uk CNAME": [{ name: "www.example.co.uk.", type: 5, TTL: 300, data: "example.co.uk." }],
        // An A query on a CNAME also returns the CNAME; it is kept only from the CNAME query.
        "www.example.co.uk A": [
          { name: "www.example.co.uk.", type: 5, TTL: 300, data: "example.co.uk." },
          { name: "example.co.uk.", type: 1, TTL: 300, data: "192.0.2.10" },
        ],
      };
      return json({ Status: 0, Answer: answers[`${name} ${type}`] });
    }
    return json({}, 404);
  };
  return calls;
}

test("the Domain tab finds the registered domain and reads its registration and DNS", async () => {
  const calls = stub();
  const result = await lookupDomain("https://www.example.co.uk/", Date.UTC(2026, 9, 1));
  assert.equal(result.domain, "example.co.uk", "www is dropped, then co.uk is kept");
  assert.equal(result.host, "www.example.co.uk");
  assert.ok(calls.includes("https://rdap.nominet.uk/uk/domain/example.co.uk"));
  assert.deepEqual(result.registration, {
    registrar: "Example Registrar Ltd",
    registered_at: Date.UTC(2010, 3, 1) / 1000,
    updated_at: Date.UTC(2026, 2, 15, 12) / 1000,
    expires_at: Date.UTC(2030, 3, 1) / 1000,
    statuses: ["client transfer prohibited", "active"],
    nameservers: ["ns1.example-dns.com", "ns2.example-dns.com"],
    dnssec: false,
  });
  assert.equal(result.registration_error, null);
  const dns = result.dns.map((r) => `${r.type} ${r.name} ${r.value} ${r.ttl}`).sort();
  assert.deepEqual(dns, [
    "A example.co.uk 192.0.2.10 300",
    "CNAME www.example.co.uk example.co.uk 300",
    "MX example.co.uk 10 mail.example.co.uk 3600",
    "NS example.co.uk ns1.example-dns.com 86400",
    "TXT example.co.uk v=spf1 include:_spf.example.com ~all 300",
  ]);
  assert.equal(result.dns_error, null);
});

test("a TLD without RDAP still shows DNS, with a reason for the missing registration", async () => {
  stub();
  const result = await lookupDomain("https://shop.example.de");
  assert.equal(result.registration, null);
  assert.match(result.registration_error, /\.de registry/);
  assert.equal(result.domain, "shop.example.de");
});
