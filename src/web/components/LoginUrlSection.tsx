import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { compareVersions, LOGIN_URL_SINCE } from "../../shared/plugin-version";
import type { LoginUrlRedirect, LoginUrlSettings, SiteSummary } from "../../shared/types";
import { fetchLoginUrl, saveLoginUrl } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { Row, Warning } from "./ToolsTab";

const REDIRECT_LABELS: Record<LoginUrlRedirect, string> = {
  "404": "A page not found error",
  home: "The home page",
};

/** Moves the WordPress login form to an address the owner picks, like the WPS Hide Login plugin. */
export function LoginUrlSection({ site }: { site: SiteSummary }) {
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, LOGIN_URL_SINCE) >= 0;
  const key = ["site", site.id, "login-url"];
  const query = useQuery({ queryKey: key, queryFn: () => fetchLoginUrl(site.id), enabled: supported });
  const saved = query.data;
  const [draft, setDraft] = useState<LoginUrlSettings | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (saved) setDraft({ enabled: saved.enabled, slug: saved.slug, redirect: saved.redirect });
  }, [saved]);
  const save = useMutation({
    mutationFn: (settings: LoginUrlSettings) => saveLoginUrl(site.id, settings),
    onSuccess: (data) => queryClient.setQueryData(key, data),
  });

  const hint =
    "Shows the WordPress login form at an address you choose, and makes wp-login.php and the signed-out wp-admin look like pages that do not exist. Password reset emails, logout links and Magic Login keep working. Turning it off, or clearing the address, puts the normal wp-login.php back at once and changes nothing else. If you are ever locked out, add define( 'KONTROLWP_DISABLE_LOGIN_URL', true ); to wp-config.php, or deactivate KontrolWP Connect.";

  if (!supported) {
    return (
      <Section title="Login page" hint={hint}>
        <EmptyRow>
          A custom login address needs KontrolWP Connect {LOGIN_URL_SINCE} or later on this site. It updates
          automatically; select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  if (!saved || !draft) {
    return (
      <Section title="Login page" hint={hint}>
        {query.error ? (
          <p className="px-4 py-6 text-center text-sm text-destructive">{query.error.message}</p>
        ) : (
          <div className="flex justify-center py-8">
            <Spinner className="size-5 text-muted-foreground" label="Loading" />
          </div>
        )}
      </Section>
    );
  }

  const dirty = draft.enabled !== saved.enabled || draft.slug !== saved.slug || draft.redirect !== saved.redirect;
  const blocked = saved.conflicts.length > 0 || saved.locked;
  const off = !draft.enabled;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The address is shown on the page to copy by hand.
    }
  };

  return (
    <Section
      title="Login page"
      hint={hint}
      action={
        save.isPending ? (
          <Spinner className="size-4 text-muted-foreground" label="Saving" />
        ) : (
          dirty && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDraft({ enabled: saved.enabled, slug: saved.slug, redirect: saved.redirect })}
              >
                Discard
              </Button>
              <Button size="sm" onClick={() => save.mutate(draft)}>
                Save changes
              </Button>
            </div>
          )
        )
      }
    >
      {saved.conflicts.length > 0 && (
        <Warning>
          {saved.conflicts.join(" and ")} {saved.conflicts.length === 1 ? "is" : "are"} active on this site and
          already {saved.conflicts.length === 1 ? "changes" : "change"} the login page. Both cannot run at once, so
          this stays off until {saved.conflicts.length === 1 ? "it is" : "they are"} deactivated.
        </Warning>
      )}
      {saved.locked && (
        <Warning>
          This site's wp-config.php sets KONTROLWP_DISABLE_LOGIN_URL, so the normal login page is in use whatever is
          chosen here.
        </Warning>
      )}
      {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
      <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <p className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium ${off ? "opacity-60" : ""}`}>
          Use a custom login address
          <HelpTip>
            {off
              ? "The normal WordPress login page, wp-login.php, is in use."
              : "wp-login.php and the signed-out wp-admin show a not found page or the home page instead of the login form."}
          </HelpTip>
        </p>
        <Switch
          checked={draft.enabled}
          disabled={blocked || save.isPending}
          onCheckedChange={(value) => setDraft({ ...draft, enabled: value })}
        />
      </label>
      <div className={`divide-y border-t ${off ? "opacity-60" : ""}`}>
        <Row title="Login address" hint="Letters, numbers, hyphens and underscores. It cannot be a name WordPress already uses, or the address of a page or post.">
          <Input
            aria-label="Login address"
            value={draft.slug}
            maxLength={60}
            disabled={off || blocked || save.isPending}
            onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
            placeholder="my-login"
            spellCheck={false}
            autoComplete="off"
          />
        </Row>
        <Row title="wp-login.php and wp-admin lead to" hint="What a visitor who is not signed in sees at the old login address.">
          <select
            aria-label="Old login address leads to"
            className={SELECT_CLASS}
            value={draft.redirect}
            disabled={off || blocked || save.isPending}
            onChange={(event) => setDraft({ ...draft, redirect: event.target.value as LoginUrlRedirect })}
          >
            {(Object.keys(REDIRECT_LABELS) as LoginUrlRedirect[]).map((value) => (
              <option key={value} value={value}>
                {REDIRECT_LABELS[value]}
              </option>
            ))}
          </select>
        </Row>
      </div>
      {saved.active && !dirty && saved.login_url && (
        <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">Your login page</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-2.5 py-1.5 font-mono text-sm">
              {saved.login_url}
            </code>
            <Button size="sm" variant="outline" onClick={() => copy(saved.login_url)}>
              {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Bookmark this address now. {saved.default_login_url} no longer shows the login form.
          </p>
        </div>
      )}
    </Section>
  );
}
