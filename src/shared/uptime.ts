import type { SslCertificate } from "./types.ts";

const DAY = 86400;
/** A certificate this close to expiring has missed its renewal: Let's Encrypt and Cloudflare renew 30 days ahead. */
export const CERTIFICATE_WARNING_DAYS = 14;

export type CertificateState =
  | { kind: "unknown"; message: string }
  | { kind: "expired" | "expiring" | "mismatch" | "ok"; days: number; message: string };

/** What a site's certificate means for its visitors, in a sentence. */
export function certificateState(cert: SslCertificate, now = Math.floor(Date.now() / 1000)): CertificateState {
  if (cert.expires_at === null) return { kind: "unknown", message: cert.error ?? "The certificate could not be read." };
  const days = Math.floor((cert.expires_at - now) / DAY);
  if (cert.expires_at <= now) {
    return { kind: "expired", days, message: "The certificate has expired. Visitors see a security warning instead of the site." };
  }
  if (cert.covers_host === false) {
    return {
      kind: "mismatch",
      days,
      message: `The certificate is not for ${cert.host}. Visitors see a security warning instead of the site.`,
    };
  }
  if (days <= CERTIFICATE_WARNING_DAYS) {
    return {
      kind: "expiring",
      days,
      message: `The certificate expires ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`} and has not been renewed. Check the host's automatic renewal.`,
    };
  }
  return { kind: "ok", days, message: `Valid for ${days} more days.` };
}

/** "45 s", "12 min", "3 h 20 min" or "2 d 4 h". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** An uptime percentage as people read them: 100%, 99.95%, 87.5%. */
export function formatRatio(ratio: number): string {
  return `${Number(ratio.toFixed(2))}%`;
}
