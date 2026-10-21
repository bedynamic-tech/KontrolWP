# Working on KontrolWP

Domain terms are in CONTEXT.md. How the pieces fit is in docs/architecture.md.

## Components

The dashboard's UI is built with PanelUI (https://panelui.dev, the `panelui-web` package). Import components from `src/components/ui/`: Button, Input, Textarea, Select, Switch, Tabs, Card and the dropdown menu there are PanelUI's, behind thin wrappers that keep the app's sizes and props. Use them for new UI, and reach for another PanelUI component (`panelui-web/<name>`) before writing one by hand. Dialog, Tooltip, Badge, Checkbox and Skeleton stay local because PanelUI has none.

## Integrations

Every outside service (Cloudflare, Google, Umami, Wordfence, and any added later) follows one structure. Keep to it when adding or changing an integration or a setting that depends on one:

1. It is an entry in `INTEGRATIONS` in `src/web/components/IntegrationsPage.tsx`, in alphabetical order, opened from the page's side menu (`?tab=<id>`).
2. Its card is wrapped in `IntegrationSection` with `configured` and `onDisable`. It counts as on while anything is saved for it. Turning a configured one off asks first, then deletes everything saved for it (keys, tokens, sign-ins, OAuth client).
3. A service with several features gives each its own switch, stored on the server (like the `google_features` setting). Each feature lists the outside APIs or permissions it needs, and setup steps only list those for features that are on. Turning off a feature with saved credentials asks first and deletes them.
4. Add a flag to `useIntegrations()` in `src/web/integrations.ts`. Every tab, card, section and site setting that needs the integration checks it and stays hidden until it is set up. Don't show "Connect X" prompts instead.
5. API routes refuse work for an integration or feature that is off. Scheduled and queued jobs skip it quietly, without recording an error on sites, and don't use data downloaded while it was on.
6. Messages say "Integrations", not "Settings". Describe the integration in docs/architecture.md, and update the website if it mentions it.
