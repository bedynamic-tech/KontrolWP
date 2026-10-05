=== KontrolWP Connect ===
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.27.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects this site to your self-hosted KontrolWP dashboard.

== Description ==

KontrolWP is a WordPress site manager that runs in your own Cloudflare account.
KontrolWP Connect lets the dashboard read this site's available updates and
pending comments, apply core, plugin and theme updates, install, activate, deactivate and delete
plugins, turn WordPress auto-updates on or off, and moderate comments. Magic Login
lets the dashboard open wp-admin as the administrator you choose in KontrolWP,
through a link that works once, for one minute.

The plugin creates this site's Connection Key. KontrolWP signs every request
with the secret in that key, which only this site and your dashboard know. The plugin adds no public pages and sends nothing on its own (when you switch on an accessibility fix in KontrolWP, it adjusts the HTML of your pages as they are sent, and switching it off puts them back; when you switch on SEO in KontrolWP, it adds title, description, social and robots tags to your pages' head, and switching it off removes them);
it only answers signed requests, and Magic Login links the dashboard asked for.

== Installation ==

1. Install and activate KontrolWP Connect.
2. Go to Settings, KontrolWP Connect and copy the Connection Key.
3. In your KontrolWP dashboard, select Add site, enter the site's address and
   paste the key.
