-- Whether a scan stopped listing addresses at the per-site cap.
ALTER TABLE link_scans ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0;
