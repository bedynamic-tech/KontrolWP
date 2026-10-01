/** The hardening fixes KontrolWP Connect can switch on (0.13.0), in the order the Security tab lists them. */
export const SECURITY_FIXES = [
  {
    id: "directory_listing",
    title: "Prevent directory listing",
    detail: "Adds an empty index.php to wp-content, plugins, themes and uploads so a server cannot list their files.",
  },
  {
    id: "generator",
    title: "Hide the WordPress version",
    detail: "Removes the generator tag from page headers and feeds, which tells attackers which version to target.",
  },
  {
    id: "rsd",
    title: "Remove the RSD link",
    detail: "Removes the Really Simple Discovery tag from page headers, which only old publishing tools use.",
  },
  {
    id: "wlw",
    title: "Remove the Windows Live Writer link",
    detail: "Removes the Windows Live Writer tag from page headers, which only a retired editor used.",
  },
  {
    id: "db_errors",
    title: "Hide database errors",
    detail: "Stops database error messages being printed into pages, where they reveal table names and queries.",
  },
  {
    id: "php_errors",
    title: "Hide PHP errors",
    detail: "Stops PHP errors being printed into pages, where they reveal file paths and code.",
  },
  {
    id: "readme",
    title: "Delete readme.html",
    detail:
      "Removes the readme.html file in the site root, which shows the WordPress version. Updates put it back, so it is removed again.",
  },
  {
    id: "file_edit",
    title: "Turn off the code editor",
    detail: "Stops administrators editing plugin and theme code in wp-admin, so one stolen login cannot plant code.",
  },
  {
    id: "xmlrpc",
    title: "Turn off XML-RPC",
    detail:
      "Blocks xmlrpc.php, which lets a password be guessed many times in one request. Turn it off unless an app you use needs it.",
  },
] as const;

export type SecurityFixId = (typeof SECURITY_FIXES)[number]["id"];
