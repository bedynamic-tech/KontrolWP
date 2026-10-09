import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { compareVersions, LOGIN_LOGO_SINCE, LOGIN_LOGO_SITE_SINCE } from "../../shared/plugin-version";
import type { LoginLogo, LoginLogoSave, LoginLogoSize, LoginLogoSource, SiteSummary } from "../../shared/types";
import { fetchLoginLogo, saveLoginLogo } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { Spinner } from "./Spinner";

const SIZE_LABELS: Record<LoginLogoSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

const SOURCE_LABELS: Record<LoginLogoSource, string> = {
  site: "The site's logo",
  upload: "An uploaded image",
};

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_BYTES = 1024 * 1024;

/** The file's bytes as base64, without the data URL prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("The image could not be read. Choose it again."));
    reader.readAsDataURL(file);
  });
}

function Line(props: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
        {props.title}
        <HelpTip>{props.hint}</HelpTip>
      </p>
      {props.children}
    </div>
  );
}

/**
 * A Site settings row that swaps the WordPress logo above the login form for
 * the site's own logo or an uploaded image. Its choices show under it while
 * it is on.
 */
export function LoginLogoSetting({ site }: { site: SiteSummary }) {
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, LOGIN_LOGO_SINCE) >= 0;
  const canPick = !!site.plugin_version && compareVersions(site.plugin_version, LOGIN_LOGO_SITE_SINCE) >= 0;
  const key = ["site", site.id, "login-logo"];
  const query = useQuery({ queryKey: key, queryFn: () => fetchLoginLogo(site.id), enabled: supported });
  const input = useRef<HTMLInputElement>(null);
  // Switched on before there is a logo to show: the choices open so one can be picked or uploaded.
  const [opened, setOpened] = useState(false);
  const save = useMutation({
    mutationFn: async (change: Omit<LoginLogoSave, "image"> & { file?: File }) => {
      const { file, ...rest } = change;
      if (!file) return saveLoginLogo(site.id, rest);
      if (!TYPES.includes(file.type)) throw new Error("The logo must be a PNG, JPEG, GIF or WebP image.");
      if (file.size > MAX_BYTES) throw new Error("The logo can be up to 1 MB.");
      return saveLoginLogo(site.id, { ...rest, image: await readBase64(file) });
    },
    onSuccess: (data: LoginLogo) => {
      queryClient.setQueryData(key, data);
      if (data.enabled) setOpened(false);
    },
  });

  const saved = query.data;
  const busy = save.isPending;
  const source: LoginLogoSource = (busy ? save.variables.source : undefined) ?? saved?.source ?? "upload";
  const uploadUrl = saved?.upload_url ?? (saved?.source === "upload" || !saved?.source ? (saved?.logo_url ?? "") : "");
  const siteUrl = saved?.site_logo_url ?? "";
  const urlFor = (value: LoginLogoSource) => (value === "site" ? siteUrl : uploadUrl);
  const logoUrl = urlFor(source);
  const hasLogo = !!logoUrl;
  const enabled = busy && !save.variables.remove ? save.variables.enabled : !!saved?.enabled;
  const open = enabled || opened;
  const base = { size: saved?.size ?? "medium", ...(canPick ? { source } : {}) };

  const note = !supported
    ? `Needs KontrolWP Connect ${LOGIN_LOGO_SINCE} or later, which installs itself on the next sync.`
    : query.error
      ? query.error.message
      : null;

  return (
    <div>
      <label className="flex cursor-pointer items-center gap-3 py-3">
        <div className={`min-w-0 flex-1 ${open ? "" : "opacity-60"}`}>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Use your own login logo
            <HelpTip>
              Shows the site's logo, or an image you upload, above the WordPress login form instead of the WordPress
              logo, linked to the home page. Turning it off brings the WordPress logo back.
            </HelpTip>
          </p>
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
          {save.error && <p className="mt-1 text-xs text-destructive">{save.error.message}</p>}
        </div>
        {(busy || (supported && query.isPending)) && <Spinner className="size-4 text-muted-foreground" />}
        <Switch
          checked={open}
          disabled={!supported || !saved || busy}
          onCheckedChange={(value) => {
            if (!value) {
              setOpened(false);
              if (saved?.enabled) save.mutate({ ...base, enabled: false });
            } else if (hasLogo) {
              save.mutate({ ...base, enabled: true });
            } else {
              setOpened(true);
            }
          }}
        />
      </label>
      {saved && open && (
        <div className="mb-3 ml-1 divide-y border-l pl-4">
          {canPick && (
            <Line
              title="Logo source"
              hint="The site's logo is the one set in WordPress, in the Customizer or the Site Editor, or its site icon when there is no logo. It follows any change made there."
            >
              <select
                aria-label="Logo source"
                className={SELECT_CLASS}
                value={source}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as LoginLogoSource;
                  save.mutate({ size: saved.size, source: next, enabled: !!urlFor(next) });
                }}
              >
                {(Object.keys(SOURCE_LABELS) as LoginLogoSource[]).map((value) => (
                  <option key={value} value={value}>
                    {SOURCE_LABELS[value]}
                  </option>
                ))}
              </select>
            </Line>
          )}
          <div className="flex items-center gap-3 py-3">
            {source === "upload" && !hasLogo && (
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
                Logo
                <HelpTip>A PNG, JPEG, GIF or WebP image up to 1 MB. It is added to the site's media library.</HelpTip>
              </p>
            )}
            {hasLogo && (
              <div className="flex h-14 min-w-0 max-w-48 flex-1 items-center justify-center rounded-md border bg-muted/40 p-2">
                <img src={logoUrl} alt="Login page logo" className="max-h-10 max-w-full object-contain" />
              </div>
            )}
            {source === "site" ? (
              hasLogo ? (
                saved.site_logo_kind === "icon" && (
                  <p className="text-xs text-muted-foreground">The site icon, as no logo is set</p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  This site has no logo or site icon set in WordPress. Set one there, or upload an image instead.
                </p>
              )
            ) : (
              <>
                <input
                  ref={input}
                  type="file"
                  accept={TYPES.join(",")}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) save.mutate({ ...base, enabled: true, file });
                  }}
                />
                <div className="ml-auto flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
                    <UploadIcon /> {hasLogo ? "Replace" : "Upload"}
                  </Button>
                  {hasLogo && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => save.mutate({ ...base, enabled: false, remove: true })}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
          <Line
            title="Logo size"
            hint="The largest the logo is drawn, keeping its shape: small fits 84 by 84 pixels like the WordPress logo, medium 200 by 100 and large the full 320 pixel width of the form. It is never drawn larger than the image."
          >
            <select
              aria-label="Logo size"
              className={SELECT_CLASS}
              value={busy ? save.variables.size : saved.size}
              disabled={!hasLogo || busy}
              onChange={(event) =>
                save.mutate({ ...base, enabled: saved.enabled, size: event.target.value as LoginLogoSize })
              }
            >
              {(Object.keys(SIZE_LABELS) as LoginLogoSize[]).map((value) => (
                <option key={value} value={value}>
                  {SIZE_LABELS[value]}
                </option>
              ))}
            </select>
          </Line>
        </div>
      )}
    </div>
  );
}
