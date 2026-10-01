import { useState } from "react";
import { Button } from "@/components/ui/button";
import { currentWorkerName, workerDashboardUrl } from "../cloudflare-dashboard";
import { CopyField } from "./CopyField";
import { DashLink } from "./DashLink";

/** 32 random bytes, generated in this browser; never sent to Presser. */
function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Shown when SITE_SECRETS_KEY is missing. `npm run deploy` creates it, but a
 * Worker deployed another way (such as a plain `wrangler deploy`) has none.
 */
export function SecretsKeySetup(props: { onRetry: () => void; retrying: boolean }) {
  const [key] = useState(newKey);
  const workerName = currentWorkerName();

  return (
    <div className="flex h-dvh min-h-[560px] justify-center overflow-y-auto bg-canvas px-4 py-10 text-foreground md:py-16">
      <div className="w-full max-w-[620px]">
        <h1 className="text-xl font-semibold tracking-tight">Add Presser's encryption key</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Presser encrypts each site's secret with a key stored as a Worker secret. This Worker
          does not have one yet, usually because it was deployed without{" "}
          <code className="font-mono text-xs">npm run deploy</code>.
        </p>

        <ol className="mt-8 space-y-4 rounded-xl border bg-background px-4 py-4 text-sm leading-6 text-muted-foreground sm:px-5 [&_strong]:font-medium [&_strong]:text-foreground">
          <li>
            1. Open{" "}
            <DashLink href={workerDashboardUrl("settings")}>
              {workerName ? `${workerName} Settings` : "your Worker's Settings"}
            </DashLink>
            , then <strong>Variables and Secrets</strong>, and select <strong>Add</strong>.
          </li>
          <li>
            2. Choose type <strong>Secret</strong>, name it{" "}
            <strong className="font-mono text-xs">SITE_SECRETS_KEY</strong>, and paste this value.
            It was made in your browser just now.
            <div className="mt-2">
              <CopyField value={key} />
            </div>
          </li>
          <li>
            3. Select <strong>Deploy</strong>, then check again below.
          </li>
        </ol>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Keep this key as it is from now on. Changing or deleting it means every site needs a new
          Connection Key.
        </p>

        <Button className="mt-6" onClick={props.onRetry} loading={props.retrying}>
          {props.retrying ? "Checking..." : "Check again"}
        </Button>
      </div>
    </div>
  );
}
