# Working on KontrolWP

Domain terms are in CONTEXT.md. How the pieces fit is in docs/architecture.md.

## Components

The dashboard's UI is built with PanelUI (https://panelui.dev, the `panelui-web` package). Import components from `src/components/ui/`: Button, Input, Textarea, Select, Switch, Tabs, Card and the dropdown menu there are PanelUI's, behind thin wrappers that keep the app's sizes and props. Use them for new UI, and reach for another PanelUI component (`panelui-web/<name>`) before writing one by hand. Dialog, Tooltip, Badge, Checkbox and Skeleton stay local because PanelUI has none.

## UI changes

The dashboard is checked with lintapple (https://github.com/gholtzap/lintapple). Before you finish a UI change:

1. Run `npm run lint:ui:seed`, start `npm run dev`, then run `npm run lint:ui`. Exit code 0 is a pass; anything else is not.
2. Fix the interface, not the check. Do not change `ui-policy.json`, add exceptions, or remove `data-ui-*` attributes to make a finding go away. A policy change needs a request from the owner.
3. Add new pages and tabs to `scripts/lint-ui.mjs`, and sample data for new states to `tests/ui/seed.sql`, so the check sees them.
4. Icon-only buttons get a `Tooltip` (or use `IconButton`), not a `title`. Let long text wrap (`wrap-break-word`) instead of `truncate`. Keep at least 8px (`gap-2`) between neighbouring buttons.
