import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * An icon loaded from a site or WordPress.org: the first source that loads,
 * else the first letter of the name.
 */
export function RemoteIcon(props: { sources: Array<string | null | undefined>; name: string; className?: string }) {
  const sources = props.sources.filter((src): src is string => !!src);
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  const box = cn("shrink-0 overflow-hidden rounded-md border bg-muted", props.className);

  if (!src) {
    return (
      <span aria-hidden className={cn(box, "flex items-center justify-center font-medium uppercase text-muted-foreground")}>
        {props.name.trim().charAt(0) || "?"}
      </span>
    );
  }
  return (
    <img
      key={src}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed((count) => count + 1)}
      className={cn(box, "object-cover")}
    />
  );
}
