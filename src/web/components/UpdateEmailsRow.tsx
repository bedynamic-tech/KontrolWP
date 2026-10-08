import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { compareVersions, UPDATE_EMAILS_SINCE } from "../../shared/plugin-version";
import type { SiteSummary } from "../../shared/types";
import { fetchUpdateEmails, saveUpdateEmails } from "../api";
import { HelpTip } from "./HelpTip";
import { Spinner } from "./Spinner";

/** A Site settings row that stops WordPress from emailing about updates. On by default. */
export function UpdateEmailsRow({ site }: { site: SiteSummary }) {
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, UPDATE_EMAILS_SINCE) >= 0;
  const key = ["update-emails", site.id];
  const query = useQuery({ queryKey: key, queryFn: () => fetchUpdateEmails(site.id), enabled: supported });
  const save = useMutation({
    mutationFn: (disabled: boolean) => saveUpdateEmails(site.id, disabled),
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  });
  const disabled = save.isPending ? save.variables === true : (query.data?.disabled ?? false);
  const note = !supported
    ? `Needs KontrolWP Connect ${UPDATE_EMAILS_SINCE} or later, which installs itself on the next sync.`
    : query.error
      ? query.error.message
      : null;
  return (
    <label className="flex cursor-pointer items-center gap-3 py-3">
      <div className={`min-w-0 flex-1 ${disabled && supported ? "" : "opacity-60"}`}>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          Disable update emails
          <HelpTip>
            Stops the emails WordPress sends about updates: the results of automatic WordPress, plugin and theme
            updates, the notice that a new WordPress version is available, and the updater's debug email. Updates
            themselves still run.
          </HelpTip>
        </p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        {save.error && <p className="mt-1 text-xs text-destructive">{save.error.message}</p>}
      </div>
      {(save.isPending || (supported && query.isPending)) && <Spinner className="size-4 text-muted-foreground" />}
      <Switch
        checked={disabled}
        disabled={!supported || query.isPending || save.isPending}
        onCheckedChange={(value) => save.mutate(value)}
      />
    </label>
  );
}
