import { Badge } from "@/components/ui/badge";
import type { SiteStatus } from "../../shared/types";

const LABELS: Record<SiteStatus, string> = {
  pending: "Waiting to connect",
  connected: "Connected",
  error: "Needs attention",
};

export function StatusBadge(props: { status: SiteStatus }) {
  const variant = props.status === "error" ? "destructive" : props.status === "pending" ? "outline" : "secondary";
  return <Badge variant={variant}>{LABELS[props.status]}</Badge>;
}
