import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { setFeatureExcluded, type SiteFeature } from "../api";
import type { SiteSummary } from "../../shared/types";
import { HelpTip } from "./HelpTip";
import { Spinner } from "./Spinner";

/** A Site settings row that turns one checking feature on or off for a single site. */
export function FeatureSwitchRow({
  site,
  feature,
  title,
  on,
  off,
}: {
  site: SiteSummary;
  feature: SiteFeature;
  title: string;
  on: string;
  off: string;
}) {
  const queryClient = useQueryClient();
  const excluded = site[`${feature}_excluded`];
  const change = useMutation({
    mutationFn: (value: boolean) => setFeatureExcluded(site.id, feature, value),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  return (
    <label className="flex cursor-pointer items-center gap-3 py-3">
      <div className={`min-w-0 flex-1 ${excluded ? "opacity-60" : ""}`}>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          <HelpTip>{excluded ? off : on}</HelpTip>
        </p>
        {change.error && (
          <p className="mt-1 text-xs text-destructive">
            {change.error.message}
          </p>
        )}
      </div>
      {change.isPending && <Spinner className="size-4 text-muted-foreground" />}
      <Switch
        checked={change.isPending ? change.variables === false : !excluded}
        disabled={change.isPending}
        onCheckedChange={(value) => change.mutate(!value)}
      />
    </label>
  );
}
