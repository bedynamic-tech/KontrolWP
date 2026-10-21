import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GoogleSettings, UmamiMode } from "../../shared/types";
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
  savePagespeedKey,
  saveUmamiSettings,
  saveWordfenceKey,
  startGoogleConnect,
} from "../api";
import { CopyField } from "./CopyField";
import { HelpTip } from "./HelpTip";
import { Section } from "./Section";
import { TwoColumns } from "./TwoColumns";

/** The services KontrolWP connects to for every site, one card each, in alphabetical order. */
const INTEGRATIONS = [
  { id: "cloudflare", Card: CloudflareCard },
  { id: "google", Card: GoogleCard },
  { id: "pagespeed", Card: PagespeedCard },
  { id: "umami", Card: UmamiCard },
  { id: "wordfence", Card: WordfenceCard },
];

export function IntegrationsPage() {
  const { hash } = useLocation();
  // A link such as /integrations#wordfence scrolls to that card.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Integrations</h1>
      {/* Alphabetical down the first column, then the second. */}
      <TwoColumns>
        {INTEGRATIONS.map(({ id, Card }) => (
          <div key={id} id={id} className="min-w-0 scroll-mt-4">
            <Card />
          </div>
        ))}
      </TwoColumns>
    </div>
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
    <Section
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
          {disconnect.error && <p className="text-sm text-destructive">{disconnect.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending}>
              {save.isPending ? "Checking..." : "Save and test"}
            </Button>
            {settings.data.configured && (
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
    </Section>
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
    <Section
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
          {remove.error && <p className="text-sm text-destructive">{remove.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={!key.trim()}>
              {save.isPending ? "Downloading..." : "Save and download"}
            </Button>
            {settings.data.configured && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove key
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}

function PagespeedCard() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings", "pagespeed"],
    queryFn: fetchPagespeedSettings,
    refetchInterval: false,
  });
  const [key, setKey] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["site"] });
  const save = useMutation({
    mutationFn: () => savePagespeedKey(key.trim()),
    onSuccess: (result) => {
      setKey("");
      queryClient.setQueryData(["settings", "pagespeed"], { configured: result.configured });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: deletePagespeedKey,
    onSuccess: (result) => {
      save.reset();
      queryClient.setQueryData(["settings", "pagespeed"], result);
      refresh();
    },
  });

  return (
    <Section
      title="Google PageSpeed Insights"
      hint={
        settings.data?.configured
          ? "Saved. Each site's Performance tab runs Google's Lighthouse tests with this key when you select Run test."
          : "Optional. When Google is connected below, PageSpeed Insights tests use that account and no key is needed; turn on the PageSpeed Insights API in the Google Cloud project that owns your client ID. A key here is used instead when saved."
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
                In the Google Cloud console, turn on the PageSpeed Insights API for a project, then create an API key
                and copy it here. The key is free to use, stored encrypted and never shown again.
              </HelpTip>
            </span>
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={settings.data.configured ? "Saved; enter a new key to replace it" : "Google API key"}
              required={!settings.data.configured}
              autoComplete="off"
            />
          </label>
          {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
          {save.isSuccess && <p className="text-sm text-muted-foreground">Saved.</p>}
          {remove.error && <p className="text-sm text-destructive">{remove.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={!key.trim()}>
              Save key
            </Button>
            {settings.data.configured && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove key
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
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
    <Section
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
          {disconnect.error && <p className="text-sm text-destructive">{disconnect.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={save.isPending} disabled={!token.trim()}>
              {save.isPending ? "Checking..." : "Save and test"}
            </Button>
            {settings.data.configured && (
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
    </Section>
  );
}

/** The Google Cloud pages the one-time setup needs, in order. */
const GOOGLE_CLOUD_LINKS = [
  { label: "1. Create the OAuth client (Credentials)", href: "https://console.cloud.google.com/apis/credentials" },
  { label: "2. Enable the Google Analytics Data API", href: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com" },
  { label: "3. Enable the Google Analytics Admin API", href: "https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com" },
  { label: "4. Enable the Google Search Console API", href: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com" },
  { label: "5. Enable the Google Site Verification API (to set sites up)", href: "https://console.cloud.google.com/apis/library/siteverification.googleapis.com" },
  { label: "6. Publish the consent screen (In production)", href: "https://console.cloud.google.com/apis/credentials/consent" },
];

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
  const forgetClient = useMutation({
    mutationFn: deleteGoogleClient,
    onSuccess: (result) => {
      connect.reset();
      setOutcome(null);
      refresh(result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    connect.mutate();
  };
  const data = settings.data;

  return (
    <Section
      title="Google"
      hint="Sign in with Google to show Google Analytics 4 and Search Console. KontrolWP only reads, and keeps a revocable sign-in that is stored encrypted."
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
                  {GOOGLE_CLOUD_LINKS.map((link) => (
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
                    Authorized redirect URIs. Also enable the Google Analytics Data API, Google Analytics Admin API and
                    Google Search Console API (and the Google Site Verification API to set sites up from KontrolWP), and under OAuth consent screen set the publishing status to In
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
          {(disconnect.error || forgetClient.error) && (
            <p className="text-sm text-destructive">{(disconnect.error ?? forgetClient.error)!.message}</p>
          )}
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
            {data!.client_configured && !data!.configured && !changingClient && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                loading={forgetClient.isPending}
                onClick={() => forgetClient.mutate()}
              >
                Remove OAuth client
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  );
}
