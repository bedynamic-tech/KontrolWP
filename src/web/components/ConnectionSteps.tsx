/** Where the Connection Key comes from: Presser Connect, on the site. */
export function ConnectionSteps(props: { siteUrl?: string }) {
  const settings = props.siteUrl ? `${props.siteUrl}/wp-admin/options-general.php?page=presser-connect` : null;
  return (
    <ol className="min-w-0 space-y-3 text-sm">
      <li>
        <p className="font-medium">1. Install Presser Connect on the site</p>
        <p className="mt-1 text-muted-foreground">
          Download it from <span className="font-medium text-foreground">Presser Connect plugin</span> in
          the sidebar, then upload it in Plugins, Add New, and activate it.
        </p>
      </li>
      <li>
        <p className="font-medium">2. Copy its Connection Key</p>
        <p className="mt-1 text-muted-foreground">
          In WordPress, open{" "}
          {settings ? (
            <a href={settings} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-2">
              Settings, Presser Connect
            </a>
          ) : (
            <span className="font-medium text-foreground">Settings, Presser Connect</span>
          )}{" "}
          and copy the key. Paste it below.
        </p>
      </li>
    </ol>
  );
}
