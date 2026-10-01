import type { SiteSummary } from "../../shared/types";

/** Checkboxes for choosing sites, with Select all. */
export function SitePicker(props: {
  sites: SiteSummary[];
  loading: boolean;
  selected: Set<number>;
  onChange: (selected: Set<number>) => void;
  /** A short note beside each site, such as its current setting. */
  detail?: (site: SiteSummary) => string | null;
  /** Shown when no site can be picked. */
  empty?: string;
}) {
  const { sites, selected } = props;
  const all = sites.length > 0 && sites.every((site) => selected.has(site.id));
  return (
    <fieldset className="space-y-1.5">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium">Sites</legend>
        {sites.length > 1 && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => props.onChange(all ? new Set() : new Set(sites.map((site) => site.id)))}
          >
            {all ? "Clear" : "Select all"}
          </button>
        )}
      </div>
      {props.loading ? (
        <p className="text-sm text-muted-foreground">Loading sites...</p>
      ) : !sites.length ? (
        <p className="text-sm text-muted-foreground">{props.empty ?? "No sites can install plugins from KontrolWP yet."}</p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border px-3 py-2">
          {sites.map((site) => (
            <label key={site.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(site.id)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(site.id)) next.delete(site.id);
                  else next.add(site.id);
                  props.onChange(next);
                }}
              />
              <span className="truncate">{site.name}</span>
              {props.detail?.(site) && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{props.detail(site)}</span>
              )}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
