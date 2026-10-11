-- Sample data for the UI check (npm run lint:ui). Local development database only.
DELETE FROM sites;
INSERT INTO sites (id, name, url, secret, status, last_synced_at, wp_version, php_version, plugin_version, theme_name, pending_comments, key_id, user_roles)
VALUES
  (1, 'Northwind Bakery', 'https://northwind.example', 'x', 'connected', unixepoch() - 600, '6.8.2', '8.3.12', '1.40.0', 'Twenty Twenty-Five', 2, 'k1', '["administrator","editor","author"]'),
  (2, 'Harbor Dental Clinic With A Long Site Name', 'https://harbor-dental-clinic-with-a-long-domain.example', 'x', 'error', unixepoch() - 86400, '6.7.1', '8.1.29', '1.38.0', 'Astra', 0, 'k2', '["administrator"]');
UPDATE sites SET last_error = 'The site did not answer within 30 seconds.' WHERE id = 2;
INSERT INTO sites (id, name, url, secret, status, kind, last_synced_at) VALUES
  (3, 'docs.example', 'https://docs.example', '', 'connected', 'static', unixepoch() - 300);
INSERT INTO site_updates (site_id, kind, slug, name, current_version, new_version) VALUES
  (1, 'core', 'wordpress', 'WordPress', '6.8.2', '6.8.3'),
  (1, 'plugin', 'woocommerce', 'WooCommerce', '9.8.1', '9.9.0'),
  (1, 'plugin', 'contact-form-7', 'Contact Form 7', '6.0.5', '6.1'),
  (1, 'theme', 'twentytwentyfive', 'Twenty Twenty-Five', '1.2', '1.3'),
  (2, 'plugin', 'woocommerce', 'WooCommerce', '9.7.0', '9.9.0');
INSERT INTO site_plugins (site_id, file, name, version, author, active, auto_update) VALUES
  (1, 'woocommerce/woocommerce.php', 'WooCommerce', '9.8.1', 'Automattic', 1, 0),
  (1, 'contact-form-7/wp-contact-form-7.php', 'Contact Form 7', '6.0.5', 'Takayuki Miyoshi', 1, 1),
  (1, 'hello-dolly/hello.php', 'Hello Dolly', '1.7.2', 'Matt Mullenweg', 0, 0),
  (2, 'woocommerce/woocommerce.php', 'WooCommerce', '9.7.0', 'Automattic', 1, 1);
INSERT INTO site_users (site_id, user_id, login, email, display_name, roles, registered) VALUES
  (1, 1, 'admin', 'owner@northwind.example', 'Dana Owner', 'administrator', unixepoch() - 31536000),
  (1, 2, 'editor', 'editor@northwind.example', 'Sam Editor', 'editor', unixepoch() - 864000),
  (2, 1, 'admin', 'admin@harbor.example', 'Harbor Admin', 'administrator', unixepoch() - 31536000);
INSERT INTO site_comments (site_id, comment_id, author, author_email, content, post_title, post_url, created_at) VALUES
  (1, 10, 'Alex Reader', 'alex@example.com', 'Do you still make the rye loaf on Saturdays?', 'Weekend menu', 'https://northwind.example/weekend-menu/', unixepoch() - 3600),
  (1, 11, 'Pat Visitor', 'pat@example.com', 'Great post, thanks for sharing the recipe.', 'Sourdough starter guide', 'https://northwind.example/sourdough/', unixepoch() - 7200);
INSERT INTO link_scans (site_id, scan_id, status, posts_scanned, total_urls, checked_urls, started_at, updated_at, finished_at)
VALUES (1, 1, 'done', 42, 4, 4, unixepoch() - 7200, unixepoch() - 7000, unixepoch() - 7000);
INSERT INTO site_links (site_id, url, status, http_status, error, checked_at, scan_id, checked_scan) VALUES
  (1, 'https://northwind.example/old-menu/', 'broken', 404, NULL, unixepoch() - 7000, 1, 1),
  (1, 'https://supplier.example/a-very-long-path/that-keeps-going/and-going/to-test-wrapping-on-phones.html', 'unresponsive', NULL, 'Timed out after 15 seconds', unixepoch() - 7000, 1, 1),
  (1, 'https://northwind.example/about/', 'ok', 200, NULL, unixepoch() - 7000, 1, 1),
  (1, 'https://social.example/northwind', 'blocked', 403, NULL, unixepoch() - 7000, 1, 1);
INSERT INTO site_link_refs (site_id, url, post_id, post_title, post_type, permalink, link_text, kind) VALUES
  (1, 'https://northwind.example/old-menu/', 5, 'Weekend menu', 'post', 'https://northwind.example/weekend-menu/', 'our old menu', 'link'),
  (1, 'https://supplier.example/a-very-long-path/that-keeps-going/and-going/to-test-wrapping-on-phones.html', 7, 'Sourdough starter guide', 'post', 'https://northwind.example/sourdough/', 'flour supplier', 'link'),
  (1, 'https://northwind.example/about/', 2, 'Home', 'page', 'https://northwind.example/', 'About us', 'link'),
  (1, 'https://social.example/northwind', 2, 'Home', 'page', 'https://northwind.example/', 'Follow us', 'link');
-- Two days of uptime checks every 15 minutes, with a one-hour outage.
WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 191)
INSERT INTO uptime_checks (site_id, checked_at, up, status_code, response_ms, error)
SELECT 1, unixepoch() - i * 900, CASE WHEN i BETWEEN 40 AND 43 THEN 0 ELSE 1 END,
  CASE WHEN i BETWEEN 40 AND 43 THEN 503 ELSE 200 END, 180 + (i * 37) % 260,
  CASE WHEN i BETWEEN 40 AND 43 THEN 'The site answered with HTTP 503.' END
FROM n;
INSERT INTO ssl_certificates (site_id, host, checked_at, source, subject, issuer, valid_from, expires_at, names, covers_host)
VALUES (1, 'northwind.example', unixepoch() - 3600, 'tls', 'CN=northwind.example', 'Let''s Encrypt R11', unixepoch() - 5184000, unixepoch() + 2592000, '["northwind.example","www.northwind.example"]', 1);
