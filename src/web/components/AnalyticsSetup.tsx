import { Link } from "react-router";
import type { ReactNode } from "react";
import type { SiteSummary } from "../../shared/types";
import { ApiError } from "../api";
import { hostname } from "../format";
import { HelpTip } from "./HelpTip";

export type CloudflareSetupState =
  | "not-connected"
  | "permission"
  | "no-sources"
  | "no-match";

/** Which setup instructions an analytics answer calls for, or null when it needs none. */
export function cloudflareSetupState(input: {
  error?: Error | null;
  website?: unknown;
  sources?: number;
  chosen?: boolean;
}): CloudflareSetupState | null {
  if (input.error instanceof ApiError) {
    if (input.error.code === "cloudflare_not_configured")
      return "not-connected";
    if (input.error.code === "cloudflare_permission") return "permission";
  }
  if (input.error || input.website) return null;
  if (input.website === undefined) return null;
  if (input.chosen) return "no-match";
  return input.sources === 0 ? "no-sources" : "no-match";
}

const DASHBOARD = "https://dash.cloudflare.com/?to=/:account/web-analytics";

function Steps(props: { children: ReactNode }) {
  return (
    <ol className="mx-auto max-w-md list-decimal space-y-1 pl-5 text-left text-sm text-muted-foreground">
      {props.children}
    </ol>
  );
}

/**
 * What to do, in place, when Cloudflare Web Analytics is not ready for a site: Cloudflare not connected,
 * a token without the permission, or no Web Analytics site for the domain. `children` is the source picker.
 */
export function CloudflareSetup(props: {
  site: SiteSummary;
  state: CloudflareSetupState;
  sources?: number;
  children?: ReactNode;
}) {
  const host = hostname(props.site.url);
  const enable = (
    <>
      <li>
        In Cloudflare, open{" "}
        <a
          href={DASHBOARD}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-4"
        >
          Analytics &amp; Logs, Web Analytics
        </a>{" "}
        and select Add a site.
      </li>
      <li>
        Enter <span className="font-medium text-foreground">{host}</span>. If
        Cloudflare proxies the site, turn on automatic setup. Otherwise copy the
        snippet it shows into the site's pages, just before the closing body
        tag.
      </li>
      <li>
        Visit the site once so Cloudflare records a visit, then reload this
        page.
      </li>
    </>
  );
  let title: string;
  let steps: ReactNode;
  let tip: string;
  switch (props.state) {
    case "not-connected":
      title = "Connect Cloudflare to read Web Analytics";
      tip =
        "KontrolWP reads Web Analytics with the same Cloudflare API token it uses for Workers. It only reads.";
      steps = (
        <>
          <li>
            In Cloudflare, open My Profile, API Tokens, and create a token with
            read access to Account Analytics (add Account Settings, Workers
            Scripts and Workers Builds Configuration for Workers).
          </li>
          <li>
            Paste it in{" "}
            <Link
              to="/settings?tab=integrations"
              className="underline underline-offset-4"
            >
              Settings, Integrations, Cloudflare
            </Link>
            .
          </li>
        </>
      );
      break;
    case "permission":
      title = "The Cloudflare token cannot read Web Analytics";
      tip =
        "Editing a token's permissions keeps the same token, so nothing needs pasting again.";
      steps = (
        <>
          <li>
            In Cloudflare, open My Profile, API Tokens, and edit the token
            KontrolWP uses.
          </li>
          <li>
            Add the permission Account, Account Analytics, Read, and save.
          </li>
          <li>Reload this page.</li>
        </>
      );
      break;
    case "no-sources":
      title = "Web Analytics is not set up in Cloudflare";
      tip =
        "Web Analytics is free in Cloudflare and counts visits without cookies. It has to be added for each site before it can be read.";
      steps = enable;
      break;
    default:
      title = `Cloudflare has no Web Analytics site for ${host}`;
      tip =
        "Web Analytics is free in Cloudflare and counts visits without cookies. It has to be added for each site before it can be read.";
      steps = (
        <>
          {enable}
          <li>
            Or, if it is set up under another name
            {props.sources ? ` (Cloudflare lists ${props.sources})` : ""},
            choose it below.
          </li>
        </>
      );
  }
  return (
    <div className="space-y-3 px-4 py-6">
      <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium">
        {title}
        <HelpTip>{tip}</HelpTip>
      </p>
      <Steps>{steps}</Steps>
      {props.children && (
        <div className="flex justify-center">{props.children}</div>
      )}
    </div>
  );
}
