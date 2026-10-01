-- The owner can rename a site. `name` stays the name shown everywhere; while
-- name_custom is 1, a sync no longer replaces it with the site's own title.
-- default_name is what Reset restores: the WordPress site title, or NULL for
-- a static site, whose default is its domain.
ALTER TABLE sites ADD COLUMN name_custom INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN default_name TEXT;
UPDATE sites SET default_name = name WHERE kind = 'wordpress';
-- A static site named something other than its domain was named by its owner.
UPDATE sites SET name_custom = 1 WHERE kind = 'static' AND url != 'https://' || name;
