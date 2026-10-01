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
import { Textarea } from "@/components/ui/textarea";
import type { SiteSummary } from "../../shared/types";
import { ApiError, createSite } from "../api";
import { ConnectionSteps } from "./ConnectionSteps";
import { MagicLoginUserForm } from "./MagicLogin";

export function AddSiteDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [connectionKey, setConnectionKey] = useState("");
  // Once connected, the dialog asks for the Magic Login administrator.
  const [added, setAdded] = useState<SiteSummary | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: () =>
      createSite({ url: url.includes("://") ? url : `https://${url}`, connection_key: connectionKey }),
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ["overview"] });
      setAdded(site);
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
              <DialogDescription>
                Choose the administrator Magic Login signs you in as.
              </DialogDescription>
            </DialogHeader>
            <MagicLoginUserForm site={added} submitLabel="Save and continue" onDone={finish} />
          </div>
        ) : (
          <form onSubmit={submit} className="min-w-0 space-y-4">
            <DialogHeader>
              <DialogTitle>Add a WordPress site</DialogTitle>
              <DialogDescription>
                KontrolWP uses the site's own name from WordPress.
              </DialogDescription>
            </DialogHeader>
            <ConnectionSteps />
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
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Connection Key</span>
              <Textarea
                value={connectionKey}
                onChange={(e) => setConnectionKey(e.target.value)}
                placeholder="presser2...."
                className="font-mono text-xs"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                required
              />
            </label>
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
