import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import type { DnsRecord, DomainRegistration, SiteSummary } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchDomain } from "../api";
import { timeAgo } from "../format";
import { EmptyRow, Section } from "./Section";

const DAY = 86400;
/** The registration shows a warning this close to expiring. */
const EXPIRY_WARNING_DAYS = 30;

const TYPE_ORDER: DnsRecord["type"][] = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA"];

/** The site's domain: registration and DNS records, looked up live from public sources. */
export function DomainSection(props: { site: SiteSummary }) {
  const domain = useQuery({
    queryKey: ["site", props.site.id, "domain"],
    queryFn: () => fetchDomain(props.site.id),
    // Public lookups change slowly; refresh on request, not on a timer.
    refetchInterval: false,
    staleTime: 60 * 60 * 1000,
  });

  const refresh = (
    <Button
      size="sm"
      variant="outline"
      onClick={() => domain.refetch()}
      disabled={domain.isFetching}
      title={domain.data ? `Checked ${timeAgo(domain.data.checked_at).toLowerCase()}` : undefined}
    >
      <RefreshCwIcon className={domain.isFetching ? "animate-spin" : ""} />
      {domain.isFetching ? "Checking..." : "Check again"}
    </Button>
  );

  if (domain.isPending) {
    return (
      <Section title="Registration">
        <EmptyRow>Looking up the domain...</EmptyRow>
      </Section>
    );
  }
  if (domain.error) {
    return (
      <Section title="Registration" action={refresh}>
        <p className="px-4 py-6 text-center text-sm text-destructive">{domain.error.message}</p>
      </Section>
    );
  }

  const data = domain.data;
  return (
    <>
      <Section title={`Registration for ${data.domain}`} action={refresh}>
        {data.registration ? (
          <Registration registration={data.registration} />
        ) : (
          <EmptyRow>{data.registration_error ?? "No registration details were found."}</EmptyRow>
        )}
      </Section>
      <Section title={`DNS records (${data.dns.length})`}>
        {data.dns_error ? (
          <p className="px-4 py-6 text-center text-sm text-destructive">{data.dns_error}</p>
        ) : data.dns.length ? (
          <DnsTable records={data.dns} />
        ) : (
          <EmptyRow>No DNS records were found.</EmptyRow>
        )}
      </Section>
    </>
  );
}

function Registration(props: { registration: DomainRegistration }) {
  const r = props.registration;
  const now = Date.now() / 1000;
  const daysLeft = r.expires_at === null ? null : Math.floor((r.expires_at - now) / DAY);
  return (
    <>
      {daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS && (
        <p
          className={cn(
            "border-b px-4 py-2.5 text-sm font-medium",
            daysLeft < 0
              ? "bg-destructive/5 text-destructive"
              : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          {daysLeft < 0
            ? "This domain has expired. Renew it with the registrar."
            : `This domain expires ${daysLeft === 0 ? "today" : `in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`}. Check that it renews.`}
        </p>
      )}
      <dl className="divide-y text-sm">
        <Row label="Registrar" value={r.registrar} />
        <Row
          label="Expires"
          value={
            r.expires_at === null
              ? null
              : `${formatDate(r.expires_at)}${daysLeft !== null && daysLeft >= 0 ? ` (in ${daysLeft} ${daysLeft === 1 ? "day" : "days"})` : ""}`
          }
        />
        <Row label="Registered" value={r.registered_at === null ? null : formatDate(r.registered_at)} />
        <Row label="Last changed" value={r.updated_at === null ? null : formatDate(r.updated_at)} />
        <Row label="Nameservers" value={r.nameservers.length ? r.nameservers.join("\n") : null} />
        <Row label="DNSSEC" value={r.dnssec === null ? null : r.dnssec ? "On" : "Off"} />
        <Row label="Status" value={r.statuses.length ? r.statuses.map(statusLabel).join("\n") : null} />
      </dl>
    </>
  );
}

function Row(props: { label: string; value: string | null }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words whitespace-pre-line">{props.value ?? "Not published"}</dd>
    </div>
  );
}

function DnsTable(props: { records: DnsRecord[] }) {
  const records = [...props.records].sort(
    (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name) || a.value.localeCompare(b.value),
  );
  return (
    <>
      {/* Phones: one record per row, the value under its type and name. */}
      <ul className="divide-y text-sm sm:hidden">
        {records.map((record) => (
          <li key={`${record.type} ${record.name} ${record.value}`} className="px-4 py-2.5">
            <p className="flex items-baseline gap-2">
              <span className="font-medium">{record.type}</span>
              <span className="min-w-0 truncate text-muted-foreground">{record.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{ttlLabel(record.ttl)}</span>
            </p>
            <p className="mt-0.5 font-mono text-xs break-all">{record.value}</p>
          </li>
        ))}
      </ul>
      <table className="hidden w-full text-sm sm:table">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Value</th>
            <th className="px-4 py-2 text-right font-medium">TTL</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => (
            <tr key={`${record.type} ${record.name} ${record.value}`} className="align-top">
              <td className="px-4 py-2 font-medium whitespace-nowrap">{record.type}</td>
              <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">{record.name}</td>
              <td className="w-full max-w-0 px-4 py-2 font-mono text-xs break-all">{record.value}</td>
              <td className="px-4 py-2 text-right whitespace-nowrap text-muted-foreground">
                {ttlLabel(record.ttl)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ttlLabel(seconds: number): string {
  if (seconds >= DAY && seconds % DAY === 0) return `${seconds / DAY}d`;
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/** "clientTransferProhibited" or "client transfer prohibited" as "Client transfer prohibited". */
function statusLabel(status: string): string {
  const words = status.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
