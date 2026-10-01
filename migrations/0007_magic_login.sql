-- The administrator Magic Login signs in as, chosen in the site's settings.
-- login_user_name is the name KontrolWP shows; the site checks the id.
ALTER TABLE sites ADD COLUMN login_user_id INTEGER;
ALTER TABLE sites ADD COLUMN login_user_name TEXT;
