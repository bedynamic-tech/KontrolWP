import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, LogInIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { compareVersions, MAGIC_LOGIN_SINCE } from "../../shared/plugin-version";
import type { SiteSummary } from "../../shared/types";
import { createMagicLogin, fetchAdmins, setMagicLoginUser } from "../api";
import { Spinner } from "./Spinner";

export function magicLoginSupported(site: SiteSummary): boolean {
  return !site.plugin_version || compareVersions(site.plugin_version, MAGIC_LOGIN_SINCE) >= 0;
}

/**
 * Opens wp-admin signed in as the chosen administrator. Without one, it
 * asks for the administrator first.
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
      <Button
        variant="outline"
        size="sm"
        onClick={open}
        disabled={pending || !magicLoginSupported(site)}
        title={magicLoginSupported(site) ? undefined : `Needs KontrolWP Connect ${MAGIC_LOGIN_SINCE} or later`}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <LogInIcon />}
        {pending ? "Opening..." : "Magic Login"}
      </Button>
      {error && <p className="max-w-72 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Choose the administrator Magic Login signs in as. Starts on the current
 * choice, or on the site's first administrator.
 */
export function MagicLoginUserForm(props: {
  site: SiteSummary;
  submitLabel: string;
  onDone: () => void;
  /** Shown beside the submit button, such as Cancel or Skip. */
  secondary?: { label: string; onClick: () => void };
}) {
  const { site, onDone } = props;
  const queryClient = useQueryClient();
  const [choice, setChoice] = useState<string | null>(null);
  const supported = magicLoginSupported(site);

  const admins = useQuery({
    queryKey: ["site", site.id, "admins"],
    queryFn: () => fetchAdmins(site.id),
    enabled: supported,
    refetchInterval: false,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: (userId: number) => setMagicLoginUser(site.id, userId),
    onSuccess: onDone,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const list = admins.data?.admins ?? [];
  const fallback = site.login_user_id ?? [...list].sort((a, b) => a.id - b.id)[0]?.id;
  const selected = choice ?? (fallback ? String(fallback) : "");
  const secondary = props.secondary && (
    <Button type="button" variant="ghost" size="sm" onClick={props.secondary.onClick}>
      {props.secondary.label}
    </Button>
  );

  if (!supported) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Magic Login needs KontrolWP Connect {MAGIC_LOGIN_SINCE} or later. This site runs {site.plugin_version}; it
          updates automatically, then you can choose an administrator from the site's menu.
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={onDone}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (selected) save.mutate(Number(selected));
      }}
    >
      <label className="block text-sm font-medium" htmlFor="magic-login-user">
        Magic Login administrator
      </label>
      {admins.isPending ? (
        <p className="text-sm text-muted-foreground">Loading the site's administrators...</p>
      ) : admins.error ? (
        <p className="text-sm text-destructive">{admins.error.message}</p>
      ) : (
        <select
          id="magic-login-user"
          value={selected}
          onChange={(event) => setChoice(event.target.value)}
          required
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
      <p className="text-xs text-muted-foreground">
        Magic Login opens wp-admin signed in as this user. Each link works once, for one minute.
      </p>
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!selected || !admins.data} loading={save.isPending}>
          {save.isPending ? "Saving..." : props.submitLabel}
        </Button>
        {secondary}
      </div>
    </form>
  );
}

const ADMIN_SELECT_CLASS =
  "h-8 w-full rounded-lg sm:max-w-56 border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

/** The Magic Login administrator as a dropdown that saves when changed. */
export function MagicLoginUserSelect(props: { site: SiteSummary; id?: string }) {
  const { site } = props;
  const queryClient = useQueryClient();
  const supported = magicLoginSupported(site);
  const admins = useQuery({
    queryKey: ["site", site.id, "admins"],
    queryFn: () => fetchAdmins(site.id),
    enabled: supported,
    refetchInterval: false,
    staleTime: 0,
  });
  const save = useMutation({
    mutationFn: (userId: number) => setMagicLoginUser(site.id, userId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["site", site.id] });
      queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  if (!supported) {
    return <p className="text-xs text-muted-foreground">Needs KontrolWP Connect {MAGIC_LOGIN_SINCE} or later</p>;
  }
  const value = save.isPending ? String(save.variables) : site.login_user_id ? String(site.login_user_id) : "";
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex items-center gap-2">
        {(save.isPending || admins.isPending) && <Spinner className="size-4 text-muted-foreground" />}
        <select
          id={props.id}
          aria-label="Magic Login administrator"
          value={value}
          disabled={admins.isPending || !!admins.error || save.isPending}
          onChange={(event) => save.mutate(Number(event.target.value))}
          className={ADMIN_SELECT_CLASS}
        >
          <option value="" disabled>
            {admins.isPending ? "Loading..." : "Choose an administrator"}
          </option>
          {/* Keep the saved choice showing while the list loads. */}
          {admins.isPending && site.login_user_id && (
            <option value={site.login_user_id}>{site.login_user_name ?? "Saved administrator"}</option>
          )}
          {admins.data?.admins.map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.display_name && admin.display_name !== admin.login
                ? `${admin.display_name} (${admin.login})`
                : admin.login}
            </option>
          ))}
        </select>
      </div>
      {(admins.error || save.error) && (
        <p className="text-xs text-destructive">{(admins.error ?? save.error)!.message}</p>
      )}
    </div>
  );
}
