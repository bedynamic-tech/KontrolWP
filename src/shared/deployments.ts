import type { SiteDeployment } from "./types.ts";

/** A build starts before the deployment it produces goes live, and Cloudflare stamps them a little apart. */
const DEPLOY_SLACK_SECONDS = 120;

/**
 * What the Deployments list shows: the builds, with the one the live version
 * came from marked, instead of a line for every version that went live. A
 * site with no builds (deployed by hand) keeps its deployments, since they are
 * all there is. `live` is the ref of the row to mark.
 */
export function visibleDeployments(rows: SiteDeployment[]): { rows: SiteDeployment[]; live: string | null } {
  const builds = rows.filter((row) => row.type === "build");
  // The newest deployment is the one serving traffic.
  const deployed = rows.find((row) => row.type === "deployment");
  if (!deployed) return { rows: builds, live: null };
  if (!builds.length) return { rows, live: deployed.ref };
  const source = builds.find(
    (row) => row.status === "success" && row.created_at <= deployed.created_at + DEPLOY_SLACK_SECONDS,
  );
  // A live version no build explains (a manual deploy) is still worth showing.
  if (!source) return { rows: [deployed, ...builds], live: deployed.ref };
  return { rows: builds, live: source.ref };
}
