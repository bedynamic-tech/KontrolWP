import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchCloudflareSettings, fetchCloudflareWorkers } from "../api";
import { SELECT_CLASS } from "./AnalyticsSection";
import { Spinner } from "./Spinner";

export interface WorkerChoice {
  account_id: string;
  worker: string;
}

const key = (choice: WorkerChoice) => `${choice.account_id}/${choice.worker}`;

/**
 * Choose the Cloudflare Worker a static site deploys from, from those the saved
 * API token can see. Explains how to connect Cloudflare when none is saved.
 */
export function CloudflareWorkerSelect(props: {
  value: WorkerChoice | null;
  onChange: (next: WorkerChoice | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const settings = useQuery({
    queryKey: ["settings", "cloudflare"],
    queryFn: fetchCloudflareSettings,
    refetchInterval: false,
  });
  const workers = useQuery({
    queryKey: ["cloudflare", "workers"],
    queryFn: fetchCloudflareWorkers,
    enabled: !!settings.data?.configured,
    refetchInterval: false,
  });

  if (settings.isPending) return <Spinner className="size-4 text-muted-foreground" label="Loading" />;
  if (!settings.data?.configured) {
    return (
      <p className="text-xs text-muted-foreground">
        Connect Cloudflare in{" "}
        <Link to="/settings" className="underline underline-offset-4">
          Settings
        </Link>{" "}
        to show this site's deployments.
      </p>
    );
  }
  if (workers.error) return <p className="text-xs text-destructive">{workers.error.message}</p>;

  const list = workers.data?.workers ?? [];
  const current =
    props.value && !list.some((w) => key({ account_id: w.account_id, worker: w.name }) === key(props.value!))
      ? props.value
      : null;
  const multipleAccounts = new Set(list.map((w) => w.account_id)).size > 1;
  return (
    <select
      aria-label="Cloudflare Worker"
      className={props.className ?? SELECT_CLASS}
      value={props.value ? key(props.value) : ""}
      disabled={props.disabled || workers.isPending}
      onChange={(event) => {
        const picked = list.find((w) => `${w.account_id}/${w.name}` === event.target.value);
        props.onChange(picked ? { account_id: picked.account_id, worker: picked.name } : null);
      }}
    >
      <option value="">{workers.isPending ? "Loading Workers..." : "None"}</option>
      {current && <option value={key(current)}>{current.worker}</option>}
      {list.map((w) => (
        <option key={`${w.account_id}/${w.name}`} value={`${w.account_id}/${w.name}`}>
          {w.name}
          {multipleAccounts ? ` (${w.account_name})` : ""}
        </option>
      ))}
    </select>
  );
}
