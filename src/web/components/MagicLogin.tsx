import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogInIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { compareVersions, MAGIC_LOGIN_SINCE } from "../../shared/plugin-version";
import type { SiteSummary } from "../../shared/types";
import { createMagicLogin, fetchAdmins, setMagicLoginUser } from "../api";

export const MAGIC_LOGIN_SECTION = "magic-login";

function supported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, MAGIC_LOGIN_SINCE) >= 0;
}

/**
 * Opens wp-admin signed in as the chosen administrator. Without one, it
 * points to the setting instead.
 */
export function MagicLoginButton(props: { site: SiteSummary; onChooseUser: () => void }) {
  const { site } = props;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function open() {
    if (!site.login_user_id) {
      props.onChooseUser();
      return;
    }
    setError(null);
    setPending(true);
    // Open the tab during the click, or the browser blocks it as a popup;
    // it goes to the one-time link once the site has made it.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const { url } = await createMagicLogin(site.id);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={open} disabled={pending || !supported(site)}>
        <LogInIcon />
        {pending ? "Opening..." : "Magic Login"}
      </Button>
      {error && <p className="max-w-72 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Choose the administrator Magic Login signs in as. */
export function MagicLoginSettings(props: { site: SiteSummary; editing: boolean; onEditingChange: (editing: boolean) => void }) {
  const { site, editing, onEditingChange } = props;
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<string>("");

  const admins = useQuery({
    queryKey: ["site", site.id, "admins"],
    queryFn: () => fetchAdmins(site.id),
    enabled: editing,
    refetchInterval: false,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: (userId: number | null) => setMagicLoginUser(site.id, userId),
    onSuccess: () => onEditingChange(false),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  if (!supported(site)) {
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        Magic Login needs Presser Connect {MAGIC_LOGIN_SINCE} or later. This site runs {site.plugin_version}; it
        updates automatically, then you can choose an administrator here.
      </p>
    );
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {site.login_user_id ? (
            <>
              Magic Login signs you in to wp-admin as <span className="font-medium text-foreground">{site.login_user_name}</span>.
            </>
          ) : (
            "Choose an administrator, and Magic Login opens wp-admin signed in as them. Each link works once, for one minute."
          )}
        </p>
        <div className="flex shrink-0 gap-2">
          {site.login_user_id && (
            <Button variant="ghost" size="sm" onClick={() => save.mutate(null)} disabled={save.isPending}>
              Turn off
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setChoice(site.login_user_id ? String(site.login_user_id) : "");
              onEditingChange(true);
            }}
          >
            {site.login_user_id ? "Change user" : "Choose user"}
          </Button>
        </div>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      </div>
    );
  }

  const list = admins.data?.admins ?? [];
  return (
    <form
      className="space-y-3 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (choice) save.mutate(Number(choice));
      }}
    >
      <label className="block text-sm font-medium" htmlFor="magic-login-user">
        Sign in as
      </label>
      {admins.isPending ? (
        <p className="text-sm text-muted-foreground">Loading the site's administrators...</p>
      ) : admins.error ? (
        <p className="text-sm text-destructive">{admins.error.message}</p>
      ) : (
        <select
          id="magic-login-user"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          required
          className="h-8 w-full max-w-sm rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="" disabled>
            Choose an administrator
          </option>
          {list.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.display_name && admin.display_name !== admin.login
                ? `${admin.display_name} (${admin.login})`
                : admin.login}
            </option>
          ))}
        </select>
      )}
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!choice || save.isPending || !admins.data}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEditingChange(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
