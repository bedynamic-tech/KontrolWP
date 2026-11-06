-- Reverting updates is gone: the Revert buttons, the previous versions
-- KontrolWP Connect kept, the versions held back after a revert, and the home
-- page check that reverted scheduled updates. Their tables and columns go too.
DELETE FROM update_jobs WHERE action = 'rollback';
ALTER TABLE update_jobs DROP COLUMN action;
DROP TABLE IF EXISTS site_rollbacks;
DROP TABLE IF EXISTS update_holds;
DROP TABLE IF EXISTS update_checks;
ALTER TABLE update_runs DROP COLUMN check_result;
ALTER TABLE update_runs DROP COLUMN check_note;
