import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UmamiMode } from "../../shared/types";
import {
  deleteUmamiSettings,
  fetchLayoutSettings,
  fetchUmamiSettings,
  saveLayoutSettings,
  saveUmamiSettings,
} from "../api";
import { Section } from "./Section";
import { Spinner } from "./Spinner";

export function SettingsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <LayoutSettingsSection />
      <UmamiSettingsSection />
    </div>
  );
}

function LayoutSettingsSection() {
  const queryClient = useQueryClient();
  const layout = useQuery({ queryKey: ["settings", "layout"], queryFn: fetchLayoutSettings, refetchInterval: false });
  const save = useMutation({
    mutationFn: saveLayoutSettings,
    onMutate: (next) => queryClient.setQueryData(["settings", "layout"], next),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings", "layout"] }),
  });
  const columns = layout.data?.site_columns ?? 1;
  const option = (value: 1 | 2, title: string, detail: string) => (
    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40">
      <input
        type="radio"
        name="site-columns"
        className="mt-1 accent-primary"
        checked={columns === value}
        disabled={layout.isPending}
        onChange={() => save.mutate({ ...layout.data, site_columns: value })}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
  return (
    <Section title="Site page layout" action={save.isPending ? <Spinner className="size-4 text-muted-foreground" label="Saving" /> : undefined}>
      <div className="divide-y">
        {option(1, "One column", "Analytics, Updates, Plugins and Comments one below the other.")}
        {option(
          2,
          "Two columns",
          "Updates, Plugins and Comments on the left, Analytics on the right. Needs Umami connected below, and a wide enough window; narrow screens keep one column.",
        )}
      </div>
      {(layout.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(layout.error ?? save.error)!.message}</p>
      )}
    </Section>
  );
}

function UmamiSettingsSection() {
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
    <Section title="Umami analytics">
      {settings.isPending ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.error ? (
        <p className="px-4 py-6 text-sm text-destructive">{settings.error.message}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            {settings.data.configured
              ? `Connected to ${settings.data.mode === "cloud" ? "Umami Cloud" : settings.data.url}. Each site's page shows its analytics from the Umami website with the same domain.`
              : "Connect Umami to see each site's visitors, pageviews and top pages on its page. Presser matches each site to the Umami website with the same domain."}
          </p>
          <Tabs value={mode} onValueChange={(value) => setMode(value as UmamiMode)}>
            <TabsList>
              <TabsTrigger value="cloud">Umami Cloud</TabsTrigger>
              <TabsTrigger value="self-hosted">Self-hosted</TabsTrigger>
            </TabsList>
            <TabsContent value="cloud" className="space-y-3 pt-3">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">API key</span>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={saved ? "Saved; enter a new key to replace it" : "api_..."}
                  required={mode === "cloud" && !saved}
                  autoComplete="off"
                />
                <span className="block text-xs text-muted-foreground">
                  Create one in Umami Cloud under Settings, API keys.
                </span>
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
                  <span className="text-sm font-medium">Password</span>
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
              <p className="text-xs text-muted-foreground">
                A view-only Umami user is enough. Presser signs in with it each time it loads analytics.
              </p>
            </TabsContent>
          </Tabs>
          <p className="text-xs text-muted-foreground">
            The {mode === "cloud" ? "API key" : "password"} is stored encrypted, like each site's connection key, and is
            never shown again.
          </p>
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
