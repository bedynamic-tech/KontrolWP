import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SettingsIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { HelpTip } from "./HelpTip";
import type { SiteSummary } from "../../shared/types";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteSite,
  fetchSite,
  fetchUmamiSettings,
  replaceConnectionKey,
  setSiteCloudflare,
  setLinksExcluded,
  setUpdatesExcluded,
  syncSite,
} from "../api";
import { timeAgo } from "../format";
import { CommentsList } from "./CommentsList";
import { ConnectionSteps } from "./ConnectionSteps";
import { PageSkeleton } from "./OverviewPage";
import {
  MagicLoginButton,
  MagicLoginUserForm,
  MagicLoginUserSelect,
} from "./MagicLogin";
import { ErrorBoundary } from "./ErrorBoundary";
import { ResponsiveTabsList, type TabItem } from "./ResponsiveTabsList";
import { SeoAuditTab } from "./SeoAuditTab";
import { SeoTab } from "./SeoTab";
import { FeatureSwitchRow } from "./FeatureSwitchRow";
import { AnalyticsSection, WebsitePicker } from "./AnalyticsSection";
import { AnalyticsTab } from "./AnalyticsTab";
import { CoreAutoUpdateRow } from "./CoreAutoUpdate";
import { PluginsSection } from "./PluginsSection";
import { UsersSection } from "./UsersSection";
import { SiteUpdatesSection } from "./SiteUpdatesSection";
import { Section } from "./Section";
import {
  compareVersions,
  KONTROLWP_CONNECT_VERSION,
  SELF_UPDATING_SINCE,
} from "../../shared/plugin-version";
import { SiteUpdatePolicyRow } from "./UpdatePolicy";
import { AccessibilityTab } from "./AccessibilityTab";
import { SiteIcon } from "./SiteIcon";
import { SiteName } from "./SiteName";
import { CloudflareWorkerSelect } from "./CloudflareWorkerSelect";
import { DeploymentsSection } from "./DeploymentsSection";
import { ConnectionBanner } from "./ConnectionBanner";
import { DomainSection } from "./DomainSection";
import { ContentTab } from "./ContentTab";
import { HealthOverview } from "./HealthOverview";
import { LinksTab } from "./LinksTab";
import { SecurityTab } from "./SecurityTab";
import { SitemapTab } from "./SitemapTab";
import { Spinner } from "./Spinner";
import { updatesRefetchInterval } from "./UpdatesList";

/** The first section in a tab sits closer to the tabs than sections sit to each other. */
const TAB_CLASS = "[&>section:first-child]:mt-6";

const WORDPRESS_TABS = [
  "overview",
  "analytics",
  "content",
  "plugins",
  "users",
  "links",
  "security",
  "seo",
  "accessibility",
  "domain",
];
const STATIC_TABS = [
  "overview",
  "analytics",
  "pages",
  "seo",
  "accessibility",
  "domain",
];
/** Deployments come from Cloudflare, so only a static site hosted there has them. */
const CLOUDFLARE_TABS = [
  "overview",
  "analytics",
  "pages",
  "deployments",
  "seo",
  "accessibility",
  "domain",
];
const TABS = [...new Set([...WORDPRESS_TABS, ...CLOUDFLARE_TABS])];

export function SitePage() {
  const id = Number(useParams().siteId);
  // The tab lives in the address, so a refresh or a shared link opens the same one.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = TABS.includes(searchParams.get("tab") ?? "")
    ? searchParams.get("tab")!
    : "overview";
  const setTab = (next: string) =>
    setSearchParams(next === "overview" ? {} : { tab: next }, {
      replace: true,
    });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [connectionKey, setConnectionKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [choosingLoginUser, setChoosingLoginUser] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Each of these opens its own dialog in place of the settings.
  const fromSettings = (open: (value: boolean) => void) => () => {
    setSettingsOpen(false);
    open(true);
  };
  const closeKeyDialog = (open: boolean) => {
    setReplacingKey(open);
    if (!open) {
      setConnectionKey("");
      replaceKey.reset();
    }
  };

  const { data, error, isPending } = useQuery({
    queryKey: ["site", id],
    queryFn: () => fetchSite(id),
    refetchInterval: (query) => {
      const job = query.state.data?.site.self_update_status;
      return job === "queued" || job === "running"
        ? 3_000
        : updatesRefetchInterval(query.state.data?.updates);
    },
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["site", id] });
    queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
  // A failed sync is recorded on the site, so the refreshed page shows why.
  const sync = useMutation({
    mutationFn: () => syncSite(id),
    onSettled: refresh,
  });
  const excludeUpdates = useMutation({
    mutationFn: (excluded: boolean) => setUpdatesExcluded(id, excluded),
    onSettled: refresh,
  });
  const excludeLinks = useMutation({
    mutationFn: (excluded: boolean) => setLinksExcluded(id, excluded),
    onSettled: refresh,
  });
  const replaceKey = useMutation({
    mutationFn: () => replaceConnectionKey(id, connectionKey),
    onSuccess: () => {
      setReplacingKey(false);
      setConnectionKey("");
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteSite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      navigate("/sites");
    },
  });

  const umami = useQuery({
    queryKey: ["settings", "umami"],
    queryFn: fetchUmamiSettings,
    refetchInterval: false,
  });
  const analyticsOn =
    !!umami.data?.configured && !data?.site.analytics_excluded;
  const twoColumns = analyticsOn;
  // The Analytics tab needs Umami connected in Settings.
  const kind = data?.site.kind;
  const tabs =
    kind === "static"
      ? data?.site.cf_hosted
        ? CLOUDFLARE_TABS
        : STATIC_TABS
      : WORDPRESS_TABS;
  const switchedOff =
    (requestedTab === "analytics" && umami.data && !analyticsOn) ||
    (requestedTab === "links" && data?.site.links_excluded) ||
    (requestedTab === "security" && data?.site.security_excluded) ||
    (requestedTab === "accessibility" && data?.site.accessibility_excluded);
  const tab =
    switchedOff || (kind && !tabs.includes(requestedTab))
      ? "overview"
      : requestedTab;

  if (isPending) return <PageSkeleton />;
  // A failed refresh keeps showing the last data; only a first load that failed shows the error.
  if (!data)
    return <p className="text-sm text-destructive">{error?.message}</p>;
  const { site, updates, comments } = data;
  const isStatic = site.kind === "static";
  const onCloudflare = isStatic && site.cf_hosted;
  const tabItems: TabItem[] = [
    { value: "overview", label: "Overview" },
    ...(analyticsOn ? [{ value: "analytics", label: "Analytics" }] : []),
    ...(isStatic
      ? [
          { value: "pages", label: "Pages" },
          ...(onCloudflare ? [{ value: "deployments", label: "Deployments" }] : []),
          { value: "seo", label: "SEO" },
        ]
      : [
          { value: "content", label: "Posts and pages" },
          { value: "plugins", label: "Plugins" },
          { value: "users", label: "Users" },
          ...(site.links_excluded ? [] : [{ value: "links", label: "Links" }]),
          ...(site.security_excluded ? [] : [{ value: "security", label: "Security" }]),
          { value: "seo", label: "SEO" },
        ]),
    ...(site.accessibility_excluded ? [] : [{ value: "accessibility", label: "Accessibility" }]),
    { value: "domain", label: "Domain" },
  ];

  return (
    <div>
      <Link
        to="/sites"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3" /> Sites
      </Link>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <SiteIcon site={site} className="size-13 text-xl" />
          <div className="min-w-0">
            <SiteName site={site} />
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              {site.url} <ExternalLinkIcon className="size-3" />
            </a>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-start gap-2">
          {!isStatic && (
            <MagicLoginButton
              site={site}
              onChooseUser={() => setChoosingLoginUser(true)}
            />
          )}
          <Button
            size="sm"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
          >
            <RefreshCwIcon className={sync.isPending ? "animate-spin" : ""} />
            {sync.isPending ? "Syncing..." : "Sync now"}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Site settings"
            title="Site settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </Button>
        </div>
      </div>

      {site.plugin_version &&
        compareVersions(site.plugin_version, SELF_UPDATING_SINCE) < 0 && (
          <div className="mt-4 rounded-xl border px-4 py-3 text-sm">
            <p className="font-medium">
              Install the new KontrolWP Connect once
            </p>
            <p className="mt-1 text-muted-foreground">
              At its last sync ({timeAgo(site.last_synced_at).toLowerCase()})
              this site reported KontrolWP Connect {site.plugin_version}, which
              cannot update itself. Install {KONTROLWP_CONNECT_VERSION} from
              KontrolWP Connect in the sidebar; later versions install
              automatically. Already did? Select Sync now.
            </p>
          </div>
        )}

      <SelfUpdateNote site={site} />

      <ConnectionBanner site={site} className="mt-4" />

      <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isStatic ? (
          <>
            <Fact
              label="Type"
              value={onCloudflare ? "Static site on Cloudflare" : "Static site"}
            />
            {onCloudflare && (
              <Fact label="Worker" value={site.cf_worker ?? "Not chosen"} />
            )}
            {onCloudflare && (
              <Fact
                label="Last deployed"
                value={
                  site.last_deployed_at
                    ? timeAgo(site.last_deployed_at)
                    : "No deployments"
                }
              />
            )}
            <Fact label="Last checked" value={timeAgo(site.last_synced_at)} />
          </>
        ) : (
          <>
            <Fact label="WordPress" value={site.wp_version} />
            <Fact label="KontrolWP Connect" value={site.plugin_version} />
            <Fact label="Theme" value={site.theme_name} />
            <Fact label="Last synced" value={timeAgo(site.last_synced_at)} />
          </>
        )}
      </dl>

      <Tabs value={tab} onValueChange={setTab} className="mt-8 gap-0">
        <ResponsiveTabsList tabs={tabItems} value={tab} onChange={setTab} label="Section" />
        <TabsContent value="overview" className={TAB_CLASS}>
          {(() => {
            const health = <HealthOverview site={site} onOpen={setTab} />;
            const main = isStatic ? (
              <>
                {health}
                {onCloudflare && (
                  <DeploymentsSection
                    site={site}
                    compact
                    onChooseWorker={() => setSettingsOpen(true)}
                  />
                )}
              </>
            ) : (
              <>
                {health}
                <SiteUpdatesSection site={site} updates={updates} />
                <Section
                  title={`Comments awaiting review (${site.pending_comments})`}
                >
                  <CommentsList comments={comments} showSite={false} />
                </Section>
              </>
            );
            // Two columns only when there is analytics to put on the right.
            return twoColumns && main ? (
              <div className="grid items-start gap-x-6 lg:grid-cols-2">
                <div className={`min-w-0 ${TAB_CLASS}`}>{main}</div>
                <div className={`min-w-0 ${TAB_CLASS}`}>
                  {analyticsOn && <AnalyticsSection site={site} />}
                </div>
              </div>
            ) : (
              <>
                {analyticsOn && <AnalyticsSection site={site} />}
                {main}
              </>
            );
          })()}
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab site={site} />
        </TabsContent>
        <TabsContent value="pages" className={TAB_CLASS}>
          {isStatic && <SitemapTab site={site} />}
        </TabsContent>
        <TabsContent value="deployments" className={TAB_CLASS}>
          {onCloudflare && (
            <DeploymentsSection
              site={site}
              onChooseWorker={() => setSettingsOpen(true)}
            />
          )}
        </TabsContent>
        <TabsContent value="content" className={TAB_CLASS}>
          <ContentTab site={site} />
        </TabsContent>
        <TabsContent value="plugins" className={TAB_CLASS}>
          <PluginsSection site={site} updates={updates} />
        </TabsContent>
        <TabsContent value="users" className={TAB_CLASS}>
          <UsersSection site={site} />
        </TabsContent>
        <TabsContent value="links" className={TAB_CLASS}>
          <LinksTab site={site} />
        </TabsContent>
        <TabsContent value="security" className={TAB_CLASS}>
          <SecurityTab site={site} />
        </TabsContent>
        <TabsContent value="seo" className={TAB_CLASS}>
          <ErrorBoundary label="The SEO tab">
            {isStatic ? <SeoAuditTab site={site} /> : <SeoTab site={site} />}
          </ErrorBoundary>
        </TabsContent>
        <TabsContent value="accessibility" className={TAB_CLASS}>
          <AccessibilityTab site={site} />
        </TabsContent>
        <TabsContent value="domain" className={TAB_CLASS}>
          <DomainSection site={site} />
        </TabsContent>
      </Tabs>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Site settings</DialogTitle>
            <DialogDescription>{site.name}</DialogDescription>
          </DialogHeader>
          <div className="divide-y border-y">
            {!isStatic && !site.updates_excluded && <CoreAutoUpdateRow site={site} className="py-3" />}
            {!isStatic && (
              <label className="flex cursor-pointer items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    Enable update checks
                    <HelpTip>
                      {site.updates_excluded
                        ? "KontrolWP does not check for or apply WordPress, plugin or theme updates on this site."
                        : "KontrolWP lists this site's WordPress, plugin and theme updates."}
                    </HelpTip>
                  </p>
                  {excludeUpdates.error && (
                    <p className="mt-1 text-xs text-destructive">
                      {excludeUpdates.error.message}
                    </p>
                  )}
                </div>
                {excludeUpdates.isPending && (
                  <Spinner className="size-4 text-muted-foreground" />
                )}
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={
                    excludeUpdates.isPending
                      ? excludeUpdates.variables === false
                      : !site.updates_excluded
                  }
                  disabled={excludeUpdates.isPending}
                  onChange={(event) =>
                    excludeUpdates.mutate(!event.target.checked)
                  }
                />
              </label>
            )}
            {!isStatic && !site.updates_excluded && (
              <SiteUpdatePolicyRow site={site} />
            )}
            {!isStatic && (
              <label className="flex cursor-pointer items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    Enable broken link checks
                    <HelpTip>
                      {site.links_excluded
                        ? "KontrolWP does not scan this site for broken links, and its Links tab is off."
                        : "KontrolWP scans this site's posts and pages for broken links."}
                    </HelpTip>
                  </p>
                  {excludeLinks.error && (
                    <p className="mt-1 text-xs text-destructive">
                      {excludeLinks.error.message}
                    </p>
                  )}
                </div>
                {excludeLinks.isPending && (
                  <Spinner className="size-4 text-muted-foreground" />
                )}
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={
                    excludeLinks.isPending
                      ? excludeLinks.variables === false
                      : !site.links_excluded
                  }
                  disabled={excludeLinks.isPending}
                  onChange={(event) =>
                    excludeLinks.mutate(!event.target.checked)
                  }
                />
              </label>
            )}
            {umami.data?.configured && (
              <FeatureSwitchRow
                site={site}
                feature="analytics"
                title="Enable analytics"
                on="This site's visitor numbers appear on its Overview and Analytics tab."
                off="KontrolWP does not read analytics for this site, and its Analytics tab is off."
              />
            )}
            {!isStatic && (
              <FeatureSwitchRow
                site={site}
                feature="security"
                title="Enable security checks"
                on="KontrolWP checks this site for known vulnerabilities and insecure settings."
                off="KontrolWP does not run security checks on this site, and its Security tab is off."
              />
            )}
            <FeatureSwitchRow
              site={site}
              feature="accessibility"
              title="Enable accessibility checks"
              on="KontrolWP scans this site for accessibility problems on a schedule."
              off="KontrolWP does not scan this site for accessibility, and its Accessibility tab is off."
            />
            {!isStatic && (
              <SettingRow
                title="Magic Login administrator"
                detail="Magic Login opens wp-admin signed in as this user."
              >
                <MagicLoginUserSelect site={site} />
              </SettingRow>
            )}
            {isStatic && <CloudflareRow site={site} />}
            {umami.data?.configured && (
              <SettingRow
                title="Umami website"
                detail="Where this site's analytics come from."
              >
                <div className="[&_select]:max-w-52">
                  <WebsitePicker
                    site={site}
                    current={site.umami_website_id}
                    chosen={!!site.umami_website_id}
                  />
                </div>
              </SettingRow>
            )}
            {!isStatic && (
              <SettingRow
                title="Connection key"
                detail="Paste a new key after creating one in KontrolWP Connect."
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fromSettings(setReplacingKey)}
                >
                  Change
                </Button>
              </SettingRow>
            )}
            <SettingRow
              title="Remove site"
              detail="KontrolWP forgets this site. Nothing changes on the site itself."
            >
              <Button
                size="sm"
                variant="destructive"
                onClick={fromSettings(setConfirmRemove)}
              >
                Remove
              </Button>
            </SettingRow>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={choosingLoginUser} onOpenChange={setChoosingLoginUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Magic Login</DialogTitle>
            <DialogDescription>
              Choose the administrator Magic Login signs you in to {site.name}{" "}
              as.
            </DialogDescription>
          </DialogHeader>
          {choosingLoginUser && (
            <MagicLoginUserForm
              site={site}
              submitLabel="Save"
              onDone={() => setChoosingLoginUser(false)}
              secondary={{
                label: "Cancel",
                onClick: () => setChoosingLoginUser(false),
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={replacingKey} onOpenChange={closeKeyDialog}>
        <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
          <form
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              replaceKey.mutate();
            }}
          >
            <DialogHeader>
              <DialogTitle>Change connection key</DialogTitle>
              <DialogDescription>
                If you created a new key in KontrolWP Connect, or reinstalled
                it, paste the site's current Connection Key here.
              </DialogDescription>
            </DialogHeader>
            <ConnectionSteps siteUrl={site.url} />
            <Textarea
              value={connectionKey}
              onChange={(e) => setConnectionKey(e.target.value)}
              placeholder="kontrolwp2...."
              className="font-mono text-xs"
              rows={3}
              spellCheck={false}
              autoComplete="off"
              required
            />
            {replaceKey.error && (
              <p className="text-sm text-destructive">
                {replaceKey.error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeKeyDialog(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={replaceKey.isPending}>
                {replaceKey.isPending ? "Connecting..." : "Save key"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {site.name}?</DialogTitle>
            <DialogDescription>
              KontrolWP forgets this site and its Connection Key; nothing
              changes on the site itself. To shut the door on the site too,
              deactivate KontrolWP Connect or create a new key there.
            </DialogDescription>
          </DialogHeader>
          {remove.error && (
            <p className="text-sm text-destructive">{remove.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => remove.mutate()}
              loading={remove.isPending}
            >
              Remove site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A setting with its control beside it, or below it on the right when `stacked` (for wide controls). */
/** Whether a static site is hosted on Cloudflare Workers and, if so, which Worker its deployments come from. */
function CloudflareRow(props: { site: SiteSummary }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (input: {
      hosted: boolean;
      account_id?: string;
      worker?: string;
    }) => setSiteCloudflare(site.id, input),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  return (
    <>
      <label className="flex cursor-pointer items-center gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Hosted on Cloudflare Workers
            <HelpTip>
              Shows this site's deployments and build logs from Cloudflare.
              Leave it off for a site hosted anywhere else.
            </HelpTip>
          </p>
          {save.error && !site.cf_hosted && (
            <p className="mt-1 text-xs text-destructive">
              {save.error.message}
            </p>
          )}
        </div>
        {save.isPending && <Spinner className="size-4 text-muted-foreground" />}
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-primary"
          checked={
            save.isPending ? save.variables?.hosted === true : site.cf_hosted
          }
          disabled={save.isPending}
          onChange={(event) => save.mutate({ hosted: event.target.checked })}
        />
      </label>
      {site.cf_hosted && (
        <SettingRow
          title="Cloudflare Worker"
          detail="The Worker this site deploys from. KontrolWP lists its deployments and build logs."
          error={save.error?.message}
          stacked
        >
          <CloudflareWorkerSelect
            value={
              site.cf_worker && site.cf_account_id
                ? { account_id: site.cf_account_id, worker: site.cf_worker }
                : null
            }
            onChange={(worker) =>
              save.mutate({
                hosted: true,
                account_id: worker?.account_id,
                worker: worker?.worker,
              })
            }
            disabled={save.isPending}
          />
        </SettingRow>
      )}
    </>
  );
}

function SettingRow(props: {
  title: string;
  detail: string;
  error?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        props.stacked
          ? "flex flex-col gap-2 py-3"
          : "flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
      }
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {props.title}
          <HelpTip>{props.detail}</HelpTip>
        </p>
        {props.error && (
          <p className="mt-1 text-xs text-destructive">{props.error}</p>
        )}
      </div>
      <div className={props.stacked ? "flex justify-end" : "shrink-0"}>
        {props.children}
      </div>
    </div>
  );
}

function Fact(props: { label: string; value: string | null }) {
  return (
    <div className="rounded-xl border bg-background px-4 py-3">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">
        {props.value || "Unknown"}
      </dd>
    </div>
  );
}

/**
 * KontrolWP Connect updates itself from the dashboard and never shows in the
 * updates list, so say here what that update is doing.
 */
function SelfUpdateNote(props: { site: SiteSummary }) {
  const { site } = props;
  const version = site.plugin_version;
  if (
    !version ||
    compareVersions(version, SELF_UPDATING_SINCE) < 0 ||
    compareVersions(version, KONTROLWP_CONNECT_VERSION) >= 0 ||
    !site.self_update_status
  ) {
    return null;
  }
  const target = site.self_update_version ?? KONTROLWP_CONNECT_VERSION;
  const active =
    site.self_update_status === "queued" ||
    site.self_update_status === "running";
  // A finished job for an older release says nothing about this one; the
  // next sync queues it.
  if (!active && site.self_update_version !== KONTROLWP_CONNECT_VERSION)
    return null;
  if (active) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
        <Spinner className="mt-0.5 size-4" />
        <span>
          {site.self_update_status === "running"
            ? "Updating"
            : "Waiting to update"}{" "}
          KontrolWP Connect from {version} to {target}...
          {site.self_update_status === "queued" && site.self_update_error && (
            <> {site.self_update_error}</>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <p className="font-medium text-destructive">
        KontrolWP Connect did not update to {target}
      </p>
      <p className="mt-1 text-muted-foreground">
        {site.self_update_status === "failed" && site.self_update_error
          ? site.self_update_error
          : `The update reported success, but the site still runs ${version}.`}{" "}
        Select Sync now to try again.
      </p>
    </div>
  );
}
