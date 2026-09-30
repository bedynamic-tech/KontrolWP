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
import type { CreatedSite } from "../../shared/types";
import { ApiError, createSite, syncSite } from "../api";
import { ConnectionSteps } from "./ConnectionSteps";

export function AddSiteDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [created, setCreated] = useState<CreatedSite | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const create = useMutation({
    mutationFn: () => createSite({ name, url: url.includes("://") ? url : `https://${url}` }),
    onSuccess: (result) => {
      setCreated(result);
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.existingId) {
        setOpen(false);
        navigate(`/sites/${error.existingId}`);
      }
    },
  });
  const sync = useMutation({
    mutationFn: () => syncSite(created!.site.id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["overview"] }),
    onSuccess: () => {
      const id = created!.site.id;
      setOpen(false);
      navigate(`/sites/${id}`);
    },
  });

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setName("");
      setUrl("");
      setCreated(null);
      create.reset();
      sync.reset();
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon /> Add site
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg [&>*]:min-w-0">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Connect {created.site.name}</DialogTitle>
              <DialogDescription>{created.site.url}</DialogDescription>
            </DialogHeader>
            <ConnectionSteps siteUrl={created.site.url} connectionKey={created.connection_key} />
            {sync.error && <p className="text-sm text-destructive">{sync.error.message}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => reset(false)}>
                Finish later
              </Button>
              <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? "Checking..." : "Sync now"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a WordPress site</DialogTitle>
              <DialogDescription>
                Presser connects to the site through the Presser Connect plugin.
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme blog" required />
            </label>
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
            {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Adding..." : "Continue"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
