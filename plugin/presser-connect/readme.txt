=== Presser Connect ===
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0

Connects this site to your self-hosted Presser dashboard.

== Description ==

Presser is a WordPress site manager that runs in your own Cloudflare account.
Presser Connect lets the dashboard read this site's available updates and
pending comments, apply plugin and theme updates, and moderate comments.

The dashboard signs every request with a secret that only this site and your
dashboard know. The plugin adds no public pages and sends nothing on its own;
it only answers signed requests.

== Installation ==

1. In your Presser dashboard, select Add site and copy the Connection Key.
2. Install and activate Presser Connect.
3. Go to Settings, Presser Connect, paste the key and select Connect.
4. Back in the dashboard, select Sync now.
