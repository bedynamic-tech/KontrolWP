import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { SiteKind, SiteSummary } from "../../shared/types";
import { ApiError, createSite } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { CloudflareWorkerSelect, type WorkerChoice } from "./CloudflareWorkerSelect";
import { ConnectionSteps } from "./ConnectionSteps";
import { MagicLoginUserForm } from "./MagicLogin";

export function AddSiteDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [connectionKey, setConnectionKey] = useState("");
  const [kind, setKind] = useState<SiteKind>("wordpress");
  const [name, setName] = useState("");
  const [onCloudflare, setOnCloudflare] = useState(false);
  const [worker, setWorker] = useState<WorkerChoice | null>(null);
  // Once connected, the dialog asks for the Magic Login administrator.
  const [added, setAdded] = useState<SiteSummary | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: () => {
      const address = url.includes("://") ? url : `https://${url}`;
      return createSite(
        kind === "static"
          ? {
              kind,
              url: address,
              name: name.trim() || undefined,
              cloudflare: onCloudflare,
              cf_account_id: onCloudflare ? worker?.account_id : undefined,
              cf_worker: onCloudflare ? worker?.worker : undefined,
            }
          : { url: address, connection_key: connectionKey },
      );
    },
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      // A static site has no Magic Login, so it is ready to open.
      if (site.kind === "static") {
        reset(false);
        navigate(`/sites/${site.id}`);
      } else {
        setAdded(site);
      }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.existingId) {
        reset(false);
        navigate(`/sites/${error.existingId}`);
      }
    },
  });

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setUrl("");
      setConnectionKey("");
      setName("");
      setWorker(null);
      setOnCloudflare(false);
      setKind("wordpress");
      setAdded(null);
      create.reset();
    }
  };

  /** Close the dialog and show the new site. */
  const finish = () => {
    const site = added;
    reset(false);
    if (site) navigate(`/sites/${site.id}`);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next || !added ? reset(next) : finish())}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add site
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        {added ? (
          <div className="min-w-0 space-y-4">
            <DialogHeader>
              <DialogTitle>{added.name} is connected</DialogTitle>
              <DialogDescription>Choose the administrator Magic Login signs you in as.</DialogDescription>
            </DialogHeader>
            <MagicLoginUserForm site={added} submitLabel="Save and continue" onDone={finish} />
          </div>
        ) : (
          <form onSubmit={submit} className="min-w-0 space-y-4">
            <DialogHeader>
              <DialogTitle>Add a site</DialogTitle>
              <DialogDescription>
                {kind === "wordpress"
                  ? "KontrolWP uses the site's own name from WordPress."
                  : "A static website, hosted anywhere. KontrolWP shows its analytics and domain, and, for a site on Cloudflare Workers, its deployments."}
              </DialogDescription>
            </DialogHeader>
            <Tabs value={kind} onValueChange={(value) => setKind(value as SiteKind)}>
              <TabsList>
                <TabsTrigger value="wordpress">WordPress</TabsTrigger>
                <TabsTrigger value="static">Static site</TabsTrigger>
              </TabsList>
            </Tabs>
            {kind === "wordpress" && <ConnectionSteps />}
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Site address</span>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                inputMode="url"
                required
              />
            </label>
            {kind === "wordpress" ? (
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Connection Key</span>
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
              </label>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">Name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Defaults to the domain"
                    maxLength={120}
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={onCloudflare}
                    onChange={(e) => setOnCloudflare(e.target.checked)}
                  />
                  Hosted on Cloudflare Workers
                </label>
                {onCloudflare && (
                  <div className="space-y-1.5">
                    <span className="block text-sm font-medium">Cloudflare Worker</span>
                    <CloudflareWorkerSelect value={worker} onChange={setWorker} className={`${SELECT_CLASS} w-full`} />
                  </div>
                )}
              </>
            )}
            {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
            <DialogFooter>
              <Button type="submit" loading={create.isPending}>
                {create.isPending ? "Connecting..." : "Add site"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
