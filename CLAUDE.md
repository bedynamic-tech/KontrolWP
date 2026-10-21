# Working on KontrolWP

Domain terms are in CONTEXT.md. How the pieces fit is in docs/architecture.md.

## Components

The dashboard's UI is built with PanelUI (https://panelui.dev, the `panelui-web` package). Import components from `src/components/ui/`: Button, Input, Textarea, Select, Switch, Tabs, Card and the dropdown menu there are PanelUI's, behind thin wrappers that keep the app's sizes and props. Use them for new UI, and reach for another PanelUI component (`panelui-web/<name>`) before writing one by hand. Dialog, Tooltip, Badge, Checkbox and Skeleton stay local because PanelUI has none.
