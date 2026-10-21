import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChartColumnIcon, CloudIcon, SearchIcon, ShieldIcon } from "lucide-react";
import { useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GoogleFeatures, GoogleSettings, UmamiMode } from "../../shared/types";
import {
  deleteCloudflareSettings,
  deleteGoogleClient,
  deleteGoogleSettings,
  deletePagespeedKey,
  deleteUmamiSettings,
  deleteWordfenceKey,
  fetchCloudflareSettings,
  fetchGoogleSettings,
  fetchPagespeedSettings,
  fetchUmamiSettings,
  fetchWordfenceSettings,
  saveCloudflareSettings,
  saveGoogleClient,
  saveGoogleFeatures,
  savePagespeedKey,
  saveUmamiSettings,
  saveWordfenceKey,
  startGoogleConnect,
} from "../api";
import { CopyField } from "./CopyField";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { SectionNav } from "./SectionNav";

/** The services KontrolWP connects to for every site, in alphabetical order. */
const INTEGRATIONS = [
  { value: "cloudflare", label: "Cloudflare", icon: <CloudIcon />, Card: CloudflareCard },
  { value: "google", label: "Google", icon: <SearchIcon />, Card: GoogleCard },
  { value: "umami", label: "Umami", icon: <ChartColumnIcon />, Card: UmamiCard },
  { value: "wordfence", label: "Wordfence", icon: <ShieldIcon />, Card: WordfenceCard },
];

/** One integration at a time, picked from a menu on the left like a site's sections. */
export function IntegrationsPage() {
  const { hash } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  // ?tab=wordfence picks one; links such as /integrations#wordfence still land on theirs.
  // PageSpeed Insights now lives under Google.
  const requested = (searchParams.get("tab") ?? hash.slice(1)).replace(/^pagespeed$/, "google");
  const current = INTEGRATIONS.find((item) => item.value === requested) ?? INTEGRATIONS[0];
  const Card = current.Card;
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
      <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <SectionNav
          groups={[{ items: INTEGRATIONS }]}
          value={current.value}
          onChange={(next) => setSearchParams({ tab: next }, { replace: true })}
          hrefFor={(next) => `?tab=${next}`}
          label="Integrations"
        />
        <div className="max-w-2xl min-w-0 [&>section:first-child]:mt-6">
          <Card key={current.value} />
        </div>
      </div>
    </div>
  );
}

/**
 * An integration's card with the switch that gates it. Its settings show only while it is
 * on. It is on while anything is saved for it; turning it off asks first, then deletes
 * everything saved for it (keys, tokens, sign-ins).
 */
function IntegrationSection(props: {
  title: string;
  hint: ReactNode;
  /** Whether anything is saved; undefined while loading. */
  configured: boolean | undefined;
  onDisable: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [turnedOn, setTurnedOn] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = !!props.configured || turnedOn;

  const change = (next: boolean) => {
    if (next) return setTurnedOn(true);
    if (props.configured) {
      setError(null);
      setConfirming(true);
    } else {
      setTurnedOn(false);
    }
  };
  const remove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await props.onDisable();
      setTurnedOn(false);
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <Section
        title={props.title}
        hint={props.hint}
        action={
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            {on ? "On" : "Off"}
            <Switch
              checked={on}
              disabled={props.configured === undefined || removing}
              onCheckedChange={change}
              aria-label={`${props.title} integration`}
            />
          </label>
        }
      >
        {on ? props.children : <EmptyRow>Turn {props.title} on to set it up.</EmptyRow>}
      </Section>
      <ConfirmTurnOff
        open={confirming}
        name={props.title}
        busy={removing}
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </>
  );
}

/** Asks before turning something off that has saved keys or sign-ins, since turning it off deletes them. */
function ConfirmTurnOff(props: {
  open: boolean;
  name: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && !props.busy && props.onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn off {props.name}?</DialogTitle>
          <DialogDescription>
            This deletes everything saved for {props.name}, such as API keys, tokens and sign-ins. To use it again,
            turn it back on and set it up from the start.
          </DialogDescription>
        </DialogHeader>
        {props.error && <p className="text-sm text-destructive">{props.error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={props.onConfirm} loading={props.busy}>
            {props.busy ? "Turning off..." : "Turn off and delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UmamiCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings", "umami"], queryFn: fetchUmamiSettings, refetchInterval: false });
  const [mode, setMode] = useState<UmamiMode>("cloud");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");

  // Start the form on what is saved.
  useEffect(() => {
    if (!settings.data?.configured) return;
    setMode(settings.data.mode);
    setUrl(settings.data.url);
    setUsername(settings.data.username);
  }, [settings.data]);

  const saved = settings.data?.configured && settings.data.mode === mode;
  const save = useMutation({
    mutationFn: () =>
      saveUmamiSettings(
        mode === "cloud"
          ? { mode, secret: secret || undefined }
          : { mode, url: url.trim(), username: username.trim(), secret: secret || undefined },
      ),
    onSuccess: (result) => {
      setSecret("");
      queryClient.setQueryData(["settings", "umami"], result);
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });
  const disconnect = useMutation({
    mutationFn: deleteUmamiSettings,
    onSuccess: (result) => {
      save.reset();
      setSecret("");
      queryClient.setQueryData(["settings", "umami"], result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <IntegrationSection
      configured={settings.data?.configured}
      onDisable={() => disconnect.mutateAsync()}
      title="Umami analytics"
      hint={
        settings.data?.configured
          ? `Connected to ${settings.data.mode === "cloud" ? "Umami Cloud" : settings.data.url}. Each site's page shows its analytics from the Umami website with the same domain.`
          : "Connect Umami to see each site's visitors, pageviews and top pages on its page. KontrolWP matches each site to the Umami website with the same domain."
      }
    >
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          <Tabs value={mode} onValueChange={(value) => setMode(value as UmamiMode)}>
            <TabsList>
              <TabsTrigger value="cloud">Umami Cloud</TabsTrigger>
              <TabsTrigger value="self-hosted">Self-hosted</TabsTrigger>
            </TabsList>
            <TabsContent value="cloud" className="space-y-3 pt-3">
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  API key
                  <HelpTip>
                    Create one in Umami Cloud under Settings, API keys. The API key is stored encrypted, like each site's
                    connection key, and is never shown again.
                  </HelpTip>
                </span>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={saved ? "Saved; enter a new key to replace it" : "api_..."}
                  required={mode === "cloud" && !saved}
                  autoComplete="off"
                />
              </label>
            </TabsContent>
            <TabsContent value="self-hosted" className="space-y-3 pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Umami address</span>
                <Input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://analytics.example.com"
                  required={mode === "self-hosted"}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Username</span>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required={mode === "self-hosted"}
                    autoComplete="off"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    Password
                    <HelpTip>
                      A view-only Umami user is enough. KontrolWP signs in with it each time it loads analytics. The
                      password is stored encrypted, like each site's connection key, and is never shown again.
                    </HelpTip>
                  </span>
                  <Input
                    type="password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={saved ? "Saved" : undefined}
                    required={mode === "self-hosted" && !saved}
                    autoComplete="new-password"
                  />
                </label>
              </div>
            </TabsContent>
          </Tabs>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && (
            <p className="text-sm text-muted-foreground">
              Connected. Umami lists {save.data.websites} {save.data.websites === 1 ? "website" : "websites"}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              {save.isPending ? "Checking..." : "Save and test"}
            </Button>
          </div>
        </form>
      )}
    </IntegrationSection>
  );
}

function WordfenceCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "wordfence"],
    queryFn: fetchWordfenceSettings,
    refetchInterval: false,
  });
  const [key, setKey] = useState("");
  const refreshSecurity = () => queryClient.invalidateQueries({ queryKey: ["site"] });
  const save = useMutation({
    mutationFn: () => saveWordfenceKey(key.trim()),
    onSuccess: (result) => {
      setKey("");
      queryClient.setQueryData(["settings", "wordfence"], { configured: result.configured });
      refreshSecurity();
    },
  });
  const remove = useMutation({
    mutationFn: deleteWordfenceKey,
    onSuccess: (result) => {
      save.reset();
      queryClient.setQueryData(["settings", "wordfence"], result);
      refreshSecurity();
    },
  });

  return (
    <IntegrationSection
      configured={settings.data?.configured}
      onDisable={() => remove.mutateAsync()}
      title="Wordfence vulnerability data"
      hint={
        settings.data?.configured
          ? "Connected. Each site's Security tab matches its WordPress and plugin versions against Wordfence's vulnerability database, downloaded once a day."
          : "Each site's Security tab lists known vulnerabilities in its WordPress and plugins from Wordfence Intelligence. Wordfence's free feed needs an API key."
      }
    >
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save.mutate();
          }}
          className="space-y-4 p-4"
        >
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              API key
              <HelpTip>
                Create a free account at wordfence.com/threat-intel, then copy the key from its API key page.
                Wordfence allows one download every 30 minutes. The key is stored encrypted and never shown again.
              </HelpTip>
            </span>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                settings.data.configured ? "Saved; enter a new key to replace it" : "Wordfence Intelligence API key"
              }
              required={!settings.data.configured}
              autoComplete="off"
            />
          </label>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && (
            <p className="text-sm text-muted-foreground">Saved. The vulnerability data is downloaded.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={!key.trim()}>
              {save.isPending ? "Downloading..." : "Save and download"}
            </Button>
          </div>
        </form>
      )}
    </IntegrationSection>
  );
}

/** The optional PageSpeed Insights API key, under the PageSpeed feature in the Google card. */
function PagespeedKeyForm() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "pagespeed"],
    queryFn: fetchPagespeedSettings,
    refetchInterval: false,
  });
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => savePagespeedKey(key.trim()),
    onSuccess: (result) => {
      setKey("");
      queryClient.setQueryData(["settings", "pagespeed"], { configured: result.configured });
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });

  if (settings.isPending) return <Skeleton className="h-8 w-full" />;
  if (settings.error) return <p className="text-sm text-destructive">{settings.error.message}</p>;
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
      className="space-y-3"
    >
      <label className="block space-y-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          API key (optional)
          <HelpTip>
            Tests use the connected Google account, so no key is needed once you turn on the PageSpeed Insights API in
            the Google Cloud project that owns your client ID. To use a key instead, turn that API on for a project,
            create an API key and paste it here. It is free, stored encrypted and never shown again.
          </HelpTip>
        </span>
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={settings.data.configured ? "Saved; enter a new key to replace it" : "Google API key"}
          required
          autoComplete="off"
        />
      </label>
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      {save.isSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}
      <Button type="submit" size="sm" loading={save.isPending} disabled={!key.trim()}>
        Save key
      </Button>
    </form>
  );
}

const GOOGLE_FEATURES: { key: keyof GoogleFeatures; title: string; hint: string }[] = [
  {
    key: "analytics",
    title: "Google Analytics",
    hint: "Lets a site read its visitors from Google Analytics 4. Needs Connect to Google.",
  },
  {
    key: "search_console",
    title: "Search Console",
    hint: "Shows each site's clicks, impressions and top queries, and sets sites up in Search Console. Needs Connect to Google.",
  },
  {
    key: "pagespeed",
    title: "PageSpeed Insights",
    hint: "Runs Google's Lighthouse tests from each site's Performance tab, with the connected Google account or an API key.",
  },
];

/** Google's services, each switched on or off on its own, under the sign-in. */
function GoogleFeatureList(props: { features: GoogleFeatures }) {
  const queryClient = useQueryClient();
  const pagespeedKey = useQuery({ queryKey: ["settings", "pagespeed"], queryFn: fetchPagespeedSettings, refetchInterval: false });
  const [confirmingPagespeed, setConfirmingPagespeed] = useState(false);
  const change = useMutation({
    mutationFn: (next: Partial<GoogleFeatures>) => saveGoogleFeatures(next),
    onSuccess: (result) => {
      queryClient.setQueryData(["settings", "google"], result);
      queryClient.invalidateQueries({ queryKey: ["site"] });
      queryClient.invalidateQueries({ queryKey: ["google"] });
    },
  });
  // Turning PageSpeed off with a key saved deletes the key, so it asks first.
  const pagespeedOff = useMutation({
    mutationFn: async () => {
      await deletePagespeedKey();
      return saveGoogleFeatures({ pagespeed: false });
    },
    onSuccess: (result) => {
      setConfirmingPagespeed(false);
      queryClient.setQueryData(["settings", "pagespeed"], { configured: false });
      queryClient.setQueryData(["settings", "google"], result);
      queryClient.invalidateQueries({ queryKey: ["site"] });
    },
  });
  const flip = (key: keyof GoogleFeatures, on: boolean) => {
    if (key === "pagespeed" && !on && pagespeedKey.data?.configured) return setConfirmingPagespeed(true);
    change.mutate({ [key]: on });
  };
  const checked = (key: keyof GoogleFeatures) =>
    change.isPending && change.variables[key] !== undefined ? !!change.variables[key] : props.features[key];

  return (
    <div className="border-t">
      <p className="px-4 pt-4 text-sm font-medium">Features</p>
      <div className="divide-y px-4">
        {GOOGLE_FEATURES.map((feature) => (
          <div key={feature.key} className="py-3">
            <label className="flex cursor-pointer items-center gap-3">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                {feature.title}
                <HelpTip>{feature.hint}</HelpTip>
              </span>
              <Switch
                checked={checked(feature.key)}
                disabled={change.isPending || pagespeedOff.isPending}
                onCheckedChange={(on) => flip(feature.key, on)}
              />
            </label>
            {props.features[feature.key] && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Needs in Google Cloud:{" "}
                {GOOGLE_FEATURE_APIS[feature.key].map((api, index) => (
                  <span key={api.href}>
                    {index > 0 && ", "}
                    <a href={api.href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                      {api.label}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {feature.key === "pagespeed" && props.features.pagespeed && (
              <div className="mt-3">
                <PagespeedKeyForm />
              </div>
            )}
          </div>
        ))}
      </div>
      {change.error && <p className="px-4 pb-3 text-sm text-destructive">{change.error.message}</p>}
      <ConfirmTurnOff
        open={confirmingPagespeed}
        name="PageSpeed Insights"
        busy={pagespeedOff.isPending}
        error={pagespeedOff.error?.message ?? null}
        onCancel={() => setConfirmingPagespeed(false)}
        onConfirm={() => pagespeedOff.mutate()}
      />
    </div>
  );
}

function CloudflareCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "cloudflare"],
    queryFn: fetchCloudflareSettings,
    refetchInterval: false,
  });
  const [token, setToken] = useState("");
  const refresh = (result: { configured: boolean }) => {
    setToken("");
    queryClient.setQueryData(["settings", "cloudflare"], { configured: result.configured });
    queryClient.invalidateQueries({ queryKey: ["cloudflare"] });
    queryClient.invalidateQueries({ queryKey: ["site"] });
  };
  const save = useMutation({ mutationFn: () => saveCloudflareSettings(token.trim()), onSuccess: refresh });
  const disconnect = useMutation({
    mutationFn: deleteCloudflareSettings,
    onSuccess: (result) => {
      save.reset();
      refresh(result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <IntegrationSection
      configured={settings.data?.configured}
      onDisable={() => disconnect.mutateAsync()}
      title="Cloudflare"
      hint={
        settings.data?.configured
          ? "Connected. A static site on Cloudflare Workers shows its deployments and build logs once you choose its Worker."
          : "Connect Cloudflare to show a static site's deployments and build logs. KontrolWP only reads from Cloudflare."
      }
    >
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              API token
              <HelpTip>
                Create a user API token in Cloudflare under My Profile, API Tokens, with read access to Account
                Settings, Workers Scripts and Workers Builds Configuration. It is stored encrypted and never shown again.
              </HelpTip>
            </span>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={settings.data.configured ? "Saved; enter a new token to replace it" : "Cloudflare API token"}
              required={!settings.data.configured}
              autoComplete="off"
            />
          </label>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && (
            <p className="text-sm text-muted-foreground">
              Connected. Cloudflare lists {save.data.workers} {save.data.workers === 1 ? "Worker" : "Workers"}.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={!token.trim()}>
              {save.isPending ? "Checking..." : "Save and test"}
            </Button>
          </div>
        </form>
      )}
    </IntegrationSection>
  );
}

/** The Google Cloud pages the one-time setup needs, in order. */
const API_LIBRARY = "https://console.cloud.google.com/apis/library/";

/** The Google Cloud APIs each Google feature needs turned on in the OAuth client's project. */
const GOOGLE_FEATURE_APIS: Record<keyof GoogleFeatures, { label: string; href: string }[]> = {
  analytics: [
    { label: "Google Analytics Data API", href: `${API_LIBRARY}analyticsdata.googleapis.com` },
    { label: "Google Analytics Admin API", href: `${API_LIBRARY}analyticsadmin.googleapis.com` },
  ],
  search_console: [
    { label: "Google Search Console API", href: `${API_LIBRARY}searchconsole.googleapis.com` },
    { label: "Google Site Verification API (to set sites up)", href: `${API_LIBRARY}siteverification.googleapis.com` },
  ],
  pagespeed: [{ label: "PageSpeed Insights API", href: `${API_LIBRARY}pagespeedonline.googleapis.com` }],
};

/** The Google Cloud pages the one-time setup needs, in order, with only the APIs of the features switched on. */
function googleCloudSteps(features: GoogleFeatures) {
  const apis = (Object.keys(GOOGLE_FEATURE_APIS) as (keyof GoogleFeatures)[])
    .filter((feature) => features[feature])
    .flatMap((feature) => GOOGLE_FEATURE_APIS[feature]);
  return [
    { label: "Create the OAuth client (Credentials)", href: "https://console.cloud.google.com/apis/credentials" },
    ...apis.map((api) => ({ label: `Enable the ${api.label}`, href: api.href })),
    { label: "Publish the consent screen (In production)", href: "https://console.cloud.google.com/apis/credentials/consent" },
  ].map((step, index) => ({ ...step, label: `${index + 1}. ${step.label}` }));
}

/** The Google account KontrolWP reads Google Analytics and Search Console with, signed in through "Connect to Google". */
function GoogleCard() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useQuery({ queryKey: ["settings", "google"], queryFn: fetchGoogleSettings, refetchInterval: false });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [changingClient, setChangingClient] = useState(false);
  // Google sends the owner back to Integrations with the result of the sign-in in the address.
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    const result = searchParams.get("google");
    if (!result) return;
    setOutcome(
      result === "connected"
        ? { ok: true, message: "Connected to Google." }
        : { ok: false, message: searchParams.get("message") || "Google did not finish the sign-in." },
    );
    queryClient.invalidateQueries({ queryKey: ["settings", "google"] });
    queryClient.invalidateQueries({ queryKey: ["google"] });
    queryClient.invalidateQueries({ queryKey: ["site"] });
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    next.delete("message");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, queryClient]);

  const refresh = (result: GoogleSettings) => {
    setClientId("");
    setClientSecret("");
    setChangingClient(false);
    queryClient.setQueryData(["settings", "google"], result);
    queryClient.invalidateQueries({ queryKey: ["google"] });
    queryClient.invalidateQueries({ queryKey: ["site"] });
  };
  const needsClient = !!settings.data && (!settings.data.client_configured || changingClient);
  // Save a new client first when one was typed, then hand over to Google.
  const connect = useMutation({
    mutationFn: async () => {
      if (needsClient) await saveGoogleClient(clientId.trim(), clientSecret.trim());
      const { url } = await startGoogleConnect();
      window.location.assign(url);
      // Keep the button busy while the browser leaves for Google.
      await new Promise(() => {});
    },
  });
  const disconnect = useMutation({
    mutationFn: deleteGoogleSettings,
    onSuccess: (result) => {
      connect.reset();
      setOutcome(null);
      refresh(result);
    },
  });
  // Turning Google off signs out, forgets the OAuth client and the PageSpeed key, and switches every feature back on.
  const turnOff = useMutation({
    mutationFn: async () => {
      await deleteGoogleSettings();
      await deletePagespeedKey();
      return deleteGoogleClient();
    },
    onSuccess: (result) => {
      connect.reset();
      setOutcome(null);
      queryClient.setQueryData(["settings", "pagespeed"], { configured: false });
      refresh(result);
    },
  });
  const pagespeedKey = useQuery({ queryKey: ["settings", "pagespeed"], queryFn: fetchPagespeedSettings, refetchInterval: false });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    connect.mutate();
  };
  const data = settings.data;

  return (
    <IntegrationSection
      configured={
        settings.data && pagespeedKey.data
          ? settings.data.configured || settings.data.client_configured || pagespeedKey.data.configured
          : undefined
      }
      onDisable={() => turnOff.mutateAsync()}
      title="Google"
      hint="Sign in with Google to show Google Analytics 4, Search Console and PageSpeed Insights. Switch each one on or off below. KontrolWP only reads, and keeps a revocable sign-in that is stored encrypted."
    >
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          {data!.configured && (
            <div className="space-y-1">
              <span className="text-sm font-medium">Connected account</span>
              <p className="text-sm break-all text-muted-foreground">
                {data!.account}
                {data!.kind === "service_account" && " (service account key)"}
              </p>
              {data!.kind === "service_account" && (
                <p className="text-xs text-muted-foreground">
                  This connection still works. Connect to Google to replace it with a sign-in.
                </p>
              )}
            </div>
          )}
          {needsClient && (
            <>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Open in Google Cloud</span>
                <ul className="space-y-1 text-sm">
                  {googleCloudSteps(data!.features).map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-4"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  Authorized redirect URI
                  <HelpTip>
                    In Google Cloud, create an OAuth client ID of type Web application and add this address under
                    Authorized redirect URIs. Also enable the APIs listed above for the features switched on below, and
                    under OAuth consent screen set the publishing status to In
                    production so the sign-in does not expire after seven days. Google warns that the app is
                    unverified; choose Advanced and continue, it is your own app.
                  </HelpTip>
                </span>
                <CopyField value={data!.redirect_uri} />
              </div>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">OAuth client ID</span>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={data!.client_id || "1234567890-abc.apps.googleusercontent.com"}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  OAuth client secret
                  <HelpTip>It is stored encrypted and never shown again.</HelpTip>
                </span>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </>
          )}
          {outcome && (
            <p className={outcome.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>{outcome.message}</p>
          )}
          {connect.error && <p className="text-sm text-destructive">{connect.error.message}</p>}
          {disconnect.error && <p className="text-sm text-destructive">{disconnect.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              loading={connect.isPending}
              disabled={needsClient && (!clientId.trim() || !clientSecret.trim())}
            >
              {data!.configured && data!.kind === "oauth" ? "Reconnect to Google" : "Connect to Google"}
            </Button>
            {data!.client_configured && !changingClient && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setChangingClient(true)}>
                Change OAuth client
              </Button>
            )}
            {changingClient && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setChangingClient(false)}>
                Cancel
              </Button>
            )}
            {data!.configured && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            )}
          </div>
        </form>
      )}
      {data && <GoogleFeatureList features={data.features} />}
    </IntegrationSection>
  );
}
