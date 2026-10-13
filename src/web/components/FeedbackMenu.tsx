import { BugIcon, LightbulbIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KONTROLWP_CONNECT_VERSION } from "../../shared/plugin-version";

const ISSUES_URL = "https://github.com/bedynamic-tech/KontrolWP/issues/new";

/**
 * Opens a new GitHub issue from one of the forms in .github/ISSUE_TEMPLATE. The version
 * field is filled in, since the Connect version shipped with the dashboard names the release.
 */
function issueUrl(template: string) {
  const params = new URLSearchParams({ template, version: KONTROLWP_CONNECT_VERSION });
  return `${ISSUES_URL}?${params}`;
}

/**
 * Links to report a bug or request a feature on GitHub. compact shows only an icon, for the
 * phone header; folded is the sidebar folded to its icons on a site's page.
 */
export function FeedbackMenu(props: { compact?: boolean; folded?: boolean }) {
  const label = "Send feedback";
  const sidebarTrigger = (
    <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent/60 [&_svg]:size-4 [&_svg]:shrink-0">
      <MessageSquareIcon />
      <span>{label}</span>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {props.compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                aria-label={label}
              >
                <MessageSquareIcon />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : props.folded ? (
        // The folded sidebar hides its labels, so the item names itself in a tooltip.
        <Tooltip>
          <TooltipTrigger asChild>{sidebarTrigger}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        sidebarTrigger
      )}
      <DropdownMenuContent align={props.compact ? "end" : "start"} side={props.compact ? "bottom" : "top"}>
        <DropdownMenuItem asChild>
          <a href={issueUrl("bug_report.yml")} target="_blank" rel="noreferrer">
            <BugIcon />
            Report a bug
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={issueUrl("feature_request.yml")} target="_blank" rel="noreferrer">
            <LightbulbIcon />
            Request a feature
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
