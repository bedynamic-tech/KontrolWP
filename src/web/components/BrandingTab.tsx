import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { compareVersions, LOGIN_LOGO_SINCE, LOGIN_LOGO_SITE_SINCE } from "../../shared/plugin-version";
import type { LoginLogo, LoginLogoSave, LoginLogoSize, LoginLogoSource, SiteSummary } from "../../shared/types";
import { fetchLoginLogo, saveLoginLogo } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { EmptyRow, Section } from "./Section";
import { Spinner } from "./Spinner";
import { Row } from "./ToolsTab";

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

const HINT =
  "Shows the site's logo, or an image you upload, above the WordPress login form instead of the WordPress logo, linked to the home page. Turning it off brings the WordPress logo back.";

/** Tools > Branding: the logo above a WordPress site's login form. */
export function BrandingTab({ site }: { site: SiteSummary }) {
  const queryClient = useQueryClient();
  const supported = !!site.plugin_version && compareVersions(site.plugin_version, LOGIN_LOGO_SINCE) >= 0;
  const key = ["site", site.id, "login-logo"];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchLoginLogo(site.id),
    enabled: supported,
  });
  const input = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: async (change: Omit<LoginLogoSave, "image"> & { file?: File }) => {
      const { file, ...rest } = change;
      if (!file) return saveLoginLogo(site.id, rest);
      if (!TYPES.includes(file.type)) throw new Error("The logo must be a PNG, JPEG, GIF or WebP image.");
      if (file.size > MAX_BYTES) throw new Error("The logo can be up to 1 MB.");
      return saveLoginLogo(site.id, { ...rest, image: await readBase64(file) });
    },
    onSuccess: (data: LoginLogo) => queryClient.setQueryData(key, data),
  });

  if (!supported) {
    return (
      <Section title="Login page logo" hint={HINT}>
        <EmptyRow>
          A custom login logo needs KontrolWP Connect {LOGIN_LOGO_SINCE} or later on this site. It updates
          automatically; select Sync now to check.
        </EmptyRow>
      </Section>
    );
  }
  const saved = query.data;
  if (!saved) {
    return (
      <Section title="Login page logo" hint={HINT}>
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

  const busy = save.isPending;
  const canPick = compareVersions(site.plugin_version ?? "", LOGIN_LOGO_SITE_SINCE) >= 0;
  const source: LoginLogoSource = (busy ? save.variables.source : undefined) ?? saved.source ?? "upload";
  const uploadUrl = saved.upload_url ?? (saved.source === "upload" || !saved.source ? saved.logo_url : "");
  const siteUrl = saved.site_logo_url ?? "";
  const urlFor = (value: LoginLogoSource) => (value === "site" ? siteUrl : uploadUrl);
  const logoUrl = urlFor(source);
  const hasLogo = !!logoUrl;
  const enabled = busy && !save.variables.remove ? save.variables.enabled : saved.enabled;
  const off = !enabled;
  const base = { size: saved.size, ...(canPick ? { source } : {}) };

  return (
    <Section title="Login page logo" hint={HINT}>
      {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
      <label className={`flex items-center gap-3 px-4 py-3 ${hasLogo ? "cursor-pointer" : ""}`}>
        <p className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium ${off ? "opacity-60" : ""}`}>
          Use your own logo
          <HelpTip>
            Shows a logo above the login form instead of the WordPress logo, linked to your home page. Turning it off
            brings the WordPress logo back.
          </HelpTip>
        </p>
        {busy && <Spinner className="size-4 text-muted-foreground" label="Saving" />}
        <Switch
          checked={enabled}
          disabled={!hasLogo || busy}
          onCheckedChange={(value) => save.mutate({ ...base, enabled: value })}
        />
      </label>
      <div className="divide-y border-t">
        {canPick && (
          <Row
            title="Logo source"
            hint="The site's logo is the one set in WordPress under Appearance, in the Customizer or the Site Editor. When the site has no logo, its site icon is used. It follows any change made there."
          >
            <select
              aria-label="Logo source"
              className={SELECT_CLASS}
              value={source}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value as LoginLogoSource;
                save.mutate({ size: saved.size, source: next, enabled: saved.enabled && !!urlFor(next) });
              }}
            >
              {(Object.keys(SOURCE_LABELS) as LoginLogoSource[]).map((value) => (
                <option key={value} value={value}>
                  {SOURCE_LABELS[value]}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row
          title="Logo"
          hint={
            source === "site"
              ? "The logo set in WordPress for this site, or its site icon when there is no logo."
              : "A PNG, JPEG, GIF or WebP image up to 1 MB. It is added to the site's media library."
          }
        >
          <div className="flex items-center justify-end gap-3">
            {hasLogo && (
              <div className="mr-auto flex h-16 min-w-0 max-w-48 items-center rounded-md border bg-muted/40 p-2">
                <img src={logoUrl} alt="Login page logo" className="max-h-12 max-w-full object-contain object-left" />
              </div>
            )}
            {source === "site" ? (
              hasLogo ? (
                saved.site_logo_kind === "icon" && (
                  <p className="shrink-0 text-sm text-muted-foreground">Site icon, as no logo is set</p>
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
                <div className="flex shrink-0 gap-2">
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
        </Row>
        <Row
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
        </Row>
      </div>
    </Section>
  );
}
