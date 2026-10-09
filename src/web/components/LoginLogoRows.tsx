import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { compareVersions, LOGIN_LOGO_SINCE } from "../../shared/plugin-version";
import type { LoginLogo, LoginLogoSave, LoginLogoSize, SiteSummary } from "../../shared/types";
import { fetchLoginLogo, saveLoginLogo } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { HelpTip } from "./HelpTip";
import { Spinner } from "./Spinner";
import { Row } from "./ToolsTab";

const SIZE_LABELS: Record<LoginLogoSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
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

/** Swaps the WordPress logo above the login form for the site's own, inside the Login page section. */
export function LoginLogoRows({ site }: { site: SiteSummary }) {
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
      <p className="border-t px-4 py-3 text-sm text-muted-foreground">
        A custom login logo needs KontrolWP Connect {LOGIN_LOGO_SINCE} or later on this site. It updates automatically;
        select Sync now to check.
      </p>
    );
  }
  const saved = query.data;
  if (!saved) {
    return query.error ? (
      <p className="border-t px-4 py-3 text-sm text-destructive">{query.error.message}</p>
    ) : (
      <div className="flex justify-center border-t py-6">
        <Spinner className="size-5 text-muted-foreground" label="Loading" />
      </div>
    );
  }

  const busy = save.isPending;
  const hasLogo = !!saved.logo_url;
  const enabled = busy && !save.variables.remove ? save.variables.enabled : saved.enabled;
  const off = !enabled;

  return (
    <div className="border-t">
      {save.error && <p className="border-b px-4 py-3 text-sm text-destructive">{save.error.message}</p>}
      <label className={`flex items-center gap-3 px-4 py-3 ${hasLogo ? "cursor-pointer" : ""}`}>
        <p className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium ${off ? "opacity-60" : ""}`}>
          Use your own logo
          <HelpTip>
            {hasLogo
              ? "Shows your logo above the login form instead of the WordPress logo, linked to your home page. Turning it off brings the WordPress logo back and keeps your image for later."
              : "Upload a logo to show above the login form instead of the WordPress logo. It links to your home page."}
          </HelpTip>
        </p>
        {busy && <Spinner className="size-4 text-muted-foreground" label="Saving" />}
        <Switch
          checked={enabled}
          disabled={!hasLogo || busy}
          onCheckedChange={(value) => save.mutate({ enabled: value, size: saved.size })}
        />
      </label>
      <div className="divide-y border-t">
        <Row title="Logo" hint="A PNG, JPEG, GIF or WebP image up to 1 MB. It is added to the site's media library.">
          <div className="flex items-center justify-end gap-3">
            {hasLogo && (
              <div className="mr-auto flex h-16 min-w-0 max-w-48 flex-1 items-center justify-center rounded-md border bg-muted/40 p-2">
                <img src={saved.logo_url} alt="Login page logo" className="max-h-12 max-w-full object-contain" />
              </div>
            )}
            <input
              ref={input}
              type="file"
              accept={TYPES.join(",")}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) save.mutate({ enabled: true, size: saved.size, file });
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
                  onClick={() =>
                    save.mutate({
                      enabled: false,
                      size: saved.size,
                      remove: true,
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </div>
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
              save.mutate({
                enabled: saved.enabled,
                size: event.target.value as LoginLogoSize,
              })
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
    </div>
  );
}
