import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AccessibilityFixDefaults } from "../../shared/types";
import { applyAccessibilityDefaults, fetchAccessibilityDefaults, saveAccessibilityDefaults } from "../api";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";

const KEY = ["settings", "accessibility"];

/** Settings > Accessibility: the automatic fixes new sites start with, and a way to give them to every site. */
export function AccessibilityDefaultsSection() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const defaults = useQuery({ queryKey: KEY, queryFn: fetchAccessibilityDefaults, refetchInterval: false });
  const save = useMutation({
    mutationFn: saveAccessibilityDefaults,
    onMutate: (enabled) =>
      queryClient.setQueryData<AccessibilityFixDefaults>(
        KEY,
        (old) => old && { ...old, fixes: old.fixes.map((fix) => ({ ...fix, enabled: enabled.includes(fix.id) })) },
      ),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
    onError: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const apply = useMutation({
    mutationFn: applyAccessibilityDefaults,
    onSuccess: () => {
      setConfirming(false);
      // Every site's Accessibility tab shows the new fixes.
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "site" && query.queryKey[2] === "accessibility" });
    },
  });
  const data = defaults.data;
  const on = data?.fixes.filter((fix) => fix.enabled) ?? [];
  const toggle = (id: string, enabled: boolean) =>
    save.mutate(data!.fixes.filter((fix) => (fix.id === id ? enabled : fix.enabled)).map((fix) => fix.id));
  const sites = data?.site_count ?? 0;
  const siteWord = `${sites} WordPress ${sites === 1 ? "site" : "sites"}`;

  return (
    <Section
      title="Automatic accessibility fixes"
      hint="Fixes change pages as they are sent to visitors and never edit content or themes. New WordPress sites start with the fixes switched on here; each site's Accessibility tab can still change its own."
      action={
        save.isPending ? (
          <Spinner className="size-4 text-muted-foreground" label="Saving" />
        ) : (
          <Button size="sm" variant="outline" disabled={!data || !sites} onClick={() => setConfirming(true)}>
            Apply to all sites
          </Button>
        )
      }
    >
      {defaults.isPending ? (
        <EmptyRow>Loading...</EmptyRow>
      ) : data ? (
        <ul className="divide-y">
          {data.fixes.map((fix) => (
            <li key={fix.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
              <div className={cn("min-w-0", !fix.enabled && "opacity-60")}>
                <p className="flex items-center gap-1.5 font-medium">
                  {fix.title}
                  <HelpTip>{fix.detail}</HelpTip>
                </p>
              </div>
              <Switch aria-label={fix.title} checked={fix.enabled} onCheckedChange={(value) => toggle(fix.id, value)} />
            </li>
          ))}
        </ul>
      ) : null}
      {apply.data && (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">
          {`Applied to ${apply.data.applied} ${apply.data.applied === 1 ? "site" : "sites"}.`}
          {apply.data.failed.length ? ` Could not reach ${apply.data.failed.join(", ")}; try again later.` : ""}
        </p>
      )}
      {(defaults.error || save.error) && (
        <p className="px-4 pb-3 text-sm text-destructive">{(defaults.error ?? save.error)!.message}</p>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !open && !apply.isPending && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply these fixes to every site?</DialogTitle>
            <DialogDescription>
              {on.length
                ? `${siteWord} will have ${on.length === 1 ? "this fix" : `these ${on.length} fixes`} on and every other fix off: ${on.map((fix) => fix.title.toLowerCase()).join("; ")}.`
                : `Every automatic fix will be turned off on ${siteWord}.`}{" "}
              Sites with accessibility checks turned off are left alone.
            </DialogDescription>
          </DialogHeader>
          {apply.error && <p className="text-sm text-destructive">{apply.error.message}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={apply.isPending}>
              Cancel
            </Button>
            <Button onClick={() => apply.mutate()} loading={apply.isPending}>
              {apply.isPending ? "Applying..." : "Apply to all sites"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
