import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SiteGoogleAds, SiteSummary } from "../../shared/types";
import { fetchGoogleAds, fetchGoogleAdsAccounts, fetchGoogleSettings, setSiteGoogleAdsAccount } from "../api";
import { count, SELECT_CLASS, Stat, useAnalyticsRange } from "./AnalyticsSection";
import { EmptyRow, Section } from "./Section";

const SETTINGS = (
  <Link to="/settings?tab=integrations" className="underline underline-offset-4">
    Settings
  </Link>
);

/** Google Ads clicks, impressions, cost and conversions for the site's chosen Ads account. */
export function GoogleAdsSection(props: { site: SiteSummary }) {
  const { site } = props;
  const [range] = useAnalyticsRange();
  const google = useQuery({ queryKey: ["settings", "google"], queryFn: fetchGoogleSettings, refetchInterval: false });
  const ready = !!google.data?.configured && google.data.can_use_ads && google.data.ads_token_configured;
  const data = useQuery({
    queryKey: ["site", site.id, "google-ads", range],
    queryFn: () => fetchGoogleAds(site.id, range),
    enabled: ready,
    refetchInterval: false,
    retry: false,
    placeholderData: (previous) => previous,
  });

  if (google.isPending || google.error) return null;
  let body;
  if (!google.data.configured) {
    body = <EmptyRow>Connect Google in {SETTINGS} to see this site's Google Ads results.</EmptyRow>;
  } else if (!google.data.can_use_ads) {
    body = <EmptyRow>Reconnect to Google in {SETTINGS} to allow Google Ads.</EmptyRow>;
  } else if (!google.data.ads_token_configured) {
    body = <EmptyRow>Add a Google Ads developer token in {SETTINGS} to see this site's Google Ads results.</EmptyRow>;
  } else if (data.isPending) {
    body = (
      <div className="space-y-3 p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  } else if (data.error) {
    body = <p className="px-4 py-6 text-center text-sm text-destructive">{data.error.message}</p>;
  } else if (!data.data.account || !data.data.totals) {
    body = (
      <div className="space-y-3 px-4 py-6 text-center">
        <p className="text-sm text-muted-foreground">
          {data.data.accounts === 0
            ? `Google Ads has no account that ${google.data.account} can read. Make sure that account is a user of the Ads account.`
            : data.data.chosen
              ? "The Google Ads account chosen for this site is no longer available."
              : "Choose the Google Ads account for this site."}
        </p>
        {data.data.accounts > 0 && <AccountPicker site={site} current="" />}
      </div>
    );
  } else {
    body = <Body site={site} data={data.data} />;
  }

  return (
    <Section title="Google Ads" hint="Figures are for the chosen account as a whole, over the selected range.">
      <div className={cn("@container", data.isPlaceholderData && "opacity-60 transition-opacity")}>{body}</div>
    </Section>
  );
}

function Body(props: { site: SiteSummary; data: SiteGoogleAds }) {
  const { data } = props;
  const totals = data.totals!;
  const money = (value: number) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: data.currency || "USD", maximumFractionDigits: value < 100 ? 2 : 0 }).format(value);
    } catch {
      return value.toFixed(2);
    }
  };
  const max = Math.max(1, ...data.series.map((point) => point.clicks));
  return (
    <div>
      <dl className="grid grid-cols-2 gap-px border-b bg-border @2xl:grid-cols-4">
        <Stat label="Clicks" stat={totals.clicks} format={count} />
        <Stat label="Impressions" stat={totals.impressions} format={count} />
        <Stat label="Cost" stat={totals.cost} format={money} lowerIsBetter />
        <Stat label="Conversions" stat={totals.conversions} format={(value) => (Math.round(value * 10) / 10).toLocaleString()} />
      </dl>
      {data.series.length > 0 && (
        <div className="border-b px-4 pt-4 pb-3">
          <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Clicks per day">
            {data.series.map((point) => (
              <div
                key={point.label}
                className="min-w-0 flex-1 rounded-t-sm bg-primary/70 hover:bg-primary"
                style={{ height: `${Math.max(2, (point.clicks / max) * 100)}%` }}
                title={`${point.label}: ${count(point.clicks)} clicks, ${money(point.cost)}`}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
            <span>{data.series[0].label}</span>
            <span>{data.series[data.series.length - 1].label}</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-xs text-muted-foreground">
        <span>Connected to {data.account!.name}</span>
        <AccountPicker site={props.site} current={data.account!.id} compact />
      </div>
    </div>
  );
}

/** Choose which Google Ads account the site uses. */
function AccountPicker(props: { site: SiteSummary; current: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ["google", "ads-accounts"], queryFn: fetchGoogleAdsAccounts, refetchInterval: false, retry: false });
  const choose = useMutation({
    mutationFn: (account: string) => setSiteGoogleAdsAccount(props.site.id, account || null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", props.site.id] }),
  });
  if (!accounts.data || accounts.data.accounts.length < (props.compact ? 2 : 1)) return null;
  return (
    <select
      aria-label="Google Ads account"
      value={props.current}
      disabled={choose.isPending}
      onChange={(event) => choose.mutate(event.target.value)}
      className={`${SELECT_CLASS} w-auto! max-w-full`}
    >
      {!props.current && <option value="">Choose an account</option>}
      {accounts.data.accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} ({account.customer})
        </option>
      ))}
    </select>
  );
}
