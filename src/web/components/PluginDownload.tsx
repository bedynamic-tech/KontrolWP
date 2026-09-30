import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The Presser Connect zip, built from plugin/presser-connect on every deploy. */
export const PLUGIN_ZIP_URL = "/downloads/presser-connect.zip";

export function PluginDownloadButton(props: { label?: string; variant?: "outline" | "ghost" }) {
  return (
    <Button variant={props.variant ?? "outline"} size="sm" asChild>
      <a href={PLUGIN_ZIP_URL} download>
        <DownloadIcon /> {props.label ?? "Download plugin"}
      </a>
    </Button>
  );
}
