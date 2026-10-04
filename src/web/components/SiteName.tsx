import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HelpTip } from "./HelpTip";
import { PencilIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import type { SiteSummary } from "../../shared/types";
import { setSiteName } from "../api";
import { hostname } from "../format";

/** What Reset restores: a WordPress site's own title, or a static site's domain. */
const defaultName = (site: SiteSummary) =>
  site.default_name || hostname(site.url).split("/")[0];

/**
 * The site's name as the page title, with a pencil that appears on hover (and
 * always on touch screens) to rename it. A new name overrides the site's own
 * title until it is reset.
 */
export function SiteName(props: { site: SiteSummary }) {
  const { site } = props;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string | null) => setSiteName(site.id, next),
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const openEditor = () => {
    setName(site.name);
    save.reset();
    setOpen(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(name.trim() === defaultName(site) ? null : name.trim() || null);
  };

  return (
    <div className="group flex min-w-0 items-center gap-1">
      <h1 className="truncate text-xl font-semibold tracking-tight">
        {site.name}
      </h1>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Rename site"
        title="Rename site"
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"
        onClick={openEditor}
      >
        <PencilIcon />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md [&>*]:min-w-0">
          <form onSubmit={submit} className="min-w-0 space-y-4">
            <DialogHeader>
              <DialogTitle>Rename site</DialogTitle>
              <DialogDescription>
                KontrolWP shows this name everywhere. It keeps it when the
                site's own title changes.
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                Name
                <HelpTip>
                  {site.kind === "static"
                    ? "Default: the domain"
                    : "Default: the title set in WordPress"}
                  , {defaultName(site)}.
                </HelpTip>
              </span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={defaultName(site)}
                maxLength={120}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            {save.error && (
              <p className="text-sm text-destructive">{save.error.message}</p>
            )}
            <DialogFooter>
              {site.name_custom && (
                <Button
                  type="button"
                  variant="ghost"
                  className="mr-auto"
                  disabled={save.isPending}
                  onClick={() => save.mutate(null)}
                >
                  Reset to default
                </Button>
              )}
              <Button
                type="submit"
                loading={save.isPending}
                disabled={!name.trim()}
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
