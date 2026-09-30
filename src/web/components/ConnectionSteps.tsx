import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyField } from "./CopyField";

/** How to install Presser Connect and paste the Connection Key. */
export function ConnectionSteps(props: { siteUrl: string; connectionKey: string }) {
  return (
    <ol className="min-w-0 space-y-4 text-sm">
      <li>
        <p className="font-medium">1. Install Presser Connect</p>
        <p className="mt-1 text-muted-foreground">
          Download the plugin, then upload it in{" "}
          <a
            href={`${props.siteUrl}/wp-admin/plugin-install.php?tab=upload`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Plugins, Add New
          </a>{" "}
          and activate it.
        </p>
        <Button variant="outline" size="sm" className="mt-2" asChild>
          <a href="/downloads/presser-connect.zip" download>
            <DownloadIcon /> presser-connect.zip
          </a>
        </Button>
      </li>
      <li>
        <p className="font-medium">2. Paste the Connection Key</p>
        <p className="mt-1 text-muted-foreground">
          Open{" "}
          <a
            href={`${props.siteUrl}/wp-admin/options-general.php?page=presser-connect`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            Settings, Presser Connect
          </a>{" "}
          and paste this key. It is shown only once, so keep this window open until you have
          pasted it.
        </p>
        <div className="mt-2">
          <CopyField value={props.connectionKey} />
        </div>
      </li>
      <li>
        <p className="font-medium">3. Sync</p>
        <p className="mt-1 text-muted-foreground">
          Select Sync now to check the connection and load updates and comments.
        </p>
      </li>
    </ol>
  );
}
