<?php
/**
 * Plugin Name:       KontrolWP Connect
 * Plugin URI:        https://github.com/bedynamic-tech/KontrolWP
 * Description:       Connects this site to your KontrolWP dashboard so you can see and act on updates and comments across all your sites.
 * Version:           0.16.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            KontrolWP
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       kontrolwp-connect
 */

/*
 * KontrolWP Connect is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 2 of the License, or (at your option)
 * any later version.
 *
 * KontrolWP Connect is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'KONTROLWP_CONNECT_VERSION', '0.16.0' );
define( 'KONTROLWP_CONNECT_FILE', __FILE__ );

require_once __DIR__ . '/includes/class-kontrolwp-connect-auth.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-rest.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-admin.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-login.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-plugins.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-users.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-links.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-content.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-security.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-accessibility.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-seo.php';
require_once __DIR__ . '/includes/class-kontrolwp-connect-redirects.php';

register_activation_hook( __FILE__, array( 'KontrolWP_Connect_Auth', 'ensure_credentials' ) );
add_action( 'rest_api_init', array( 'KontrolWP_Connect_Rest', 'register_routes' ) );
add_action( 'plugins_loaded', array( 'KontrolWP_Connect_Security', 'boot' ) );
add_action( 'plugins_loaded', array( 'KontrolWP_Connect_Accessibility', 'boot' ) );
add_action( 'plugins_loaded', array( 'KontrolWP_Connect_SEO', 'boot' ) );
add_action( 'plugins_loaded', array( 'KontrolWP_Connect_Redirects', 'boot' ) );
KontrolWP_Connect_Login::init();

if ( is_admin() ) {
	KontrolWP_Connect_Admin::init();
}
