# Working on KontrolWP

Domain terms are in CONTEXT.md. How the pieces fit is in docs/architecture.md.

## UI changes

The dashboard is checked with lintapple (https://github.com/gholtzap/lintapple). Before you finish a UI change:

1. Run `npm run lint:ui:seed`, start `npm run dev`, then run `npm run lint:ui`. Exit code 0 is a pass; anything else is not.
2. Fix the interface, not the check. Do not change `ui-policy.json`, add exceptions, or remove `data-ui-*` attributes to make a finding go away. A policy change needs a request from the owner.
3. Add new pages and tabs to `scripts/lint-ui.mjs`, and sample data for new states to `tests/ui/seed.sql`, so the check sees them.
4. Icon-only buttons get a `Tooltip` (or use `IconButton`), not a `title`. Let long text wrap (`wrap-break-word`) instead of `truncate`. Keep at least 8px (`gap-2`) between neighbouring buttons.
