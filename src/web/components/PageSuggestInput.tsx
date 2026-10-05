import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import type { SeoPage, SiteSummary } from "../../shared/types";
import { fetchSeoPages } from "../api";
import { cn } from "@/lib/utils";

const MAX_SUGGESTIONS = 8;

/** A page's address as a redirect target: a path when it is on the site, else the full address. */
function targetFor(permalink: string, siteUrl: string): string {
  try {
    const page = new URL(permalink);
    const site = new URL(siteUrl);
    return page.host.toLowerCase() === site.host.toLowerCase() ? `${page.pathname}${page.search}` : permalink;
  } catch {
    return permalink;
  }
}

/**
 * A text box for an address that suggests the site's published pages and posts as
 * you type. Any address can still be typed: the suggestions only fill the box.
 */
export function PageSuggestInput(props: {
  site: SiteSummary;
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { site, value } = props;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Search once typing pauses, on the words of the address rather than its slashes.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(value.replace(/^\/+|\/+$/g, "").trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  const searchable = open && term.length >= 2 && !/^https?:/i.test(term);
  const pages = useQuery({
    queryKey: ["site", site.id, "seo", "pages", "suggest", term],
    queryFn: () => fetchSeoPages(site.id, 1, term),
    enabled: searchable,
    staleTime: 60_000,
    retry: false,
  });
  const suggestions: SeoPage[] = searchable ? (pages.data?.items ?? []).slice(0, MAX_SUGGESTIONS) : [];
  const showing = open && suggestions.length > 0;

  function choose(page: SeoPage) {
    props.onChange(targetFor(page.permalink, site.url));
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <Input
        id={props.id}
        value={value}
        placeholder={props.placeholder}
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(event) => {
          props.onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!showing) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((active + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((active - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Enter" && active >= 0) {
            event.preventDefault();
            choose(suggestions[active]);
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {showing && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md"
        >
          {suggestions.map((page, index) => (
            <li
              key={page.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Pointer down keeps focus in the box, so the list is still there when the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(page)}
              className={cn("cursor-pointer rounded-md px-2 py-1.5", index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
            >
              <p className="truncate font-medium">{page.title || "(no title)"}</p>
              <p className="truncate text-xs text-muted-foreground">{targetFor(page.permalink, site.url)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
