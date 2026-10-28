-- A running accessibility scan: the pages still to read and what the pages
-- read so far showed. Each queue message reads a few pages, so a scan of many
-- pages stays inside a Worker run's limits (src/worker/sites/accessibility.ts).
ALTER TABLE accessibility_scans ADD COLUMN progress TEXT;
