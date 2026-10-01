=== Presser Connect ===
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.5.1
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects this site to your self-hosted Presser dashboard.

== Description ==

Presser is a WordPress site manager that runs in your own Cloudflare account.
Presser Connect lets the dashboard read this site's available updates and
pending comments, apply core, plugin and theme updates, and moderate comments. Magic Login
lets the dashboard open wp-admin as the administrator you choose in Presser,
through a link that works once, for one minute.

The plugin creates this site's Connection Key. Presser signs every request
with the secret in that key, which only this site and your dashboard know. The plugin adds no public pages and sends nothing on its own;
it only answers signed requests, and Magic Login links the dashboard asked for.

== Installation ==

1. Install and activate Presser Connect.
2. Go to Settings, Presser Connect and copy the Connection Key.
3. In your Presser dashboard, select Add site, enter the site's address and
   paste the key.
