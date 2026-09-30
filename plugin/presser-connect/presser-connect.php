<?php
/**
 * Plugin Name:       Presser Connect
 * Plugin URI:        https://github.com/bedynamic-tech/Presser
 * Description:       Connects this site to your Presser dashboard so you can see and act on updates and comments across all your sites.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Presser
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       presser-connect
 */

/*
 * Presser Connect is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 2 of the License, or (at your option)
 * any later version.
 *
 * Presser Connect is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
 * more details.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PRESSER_CONNECT_VERSION', '0.1.0' );
define( 'PRESSER_CONNECT_FILE', __FILE__ );

require_once __DIR__ . '/includes/class-presser-connect-auth.php';
require_once __DIR__ . '/includes/class-presser-connect-rest.php';
require_once __DIR__ . '/includes/class-presser-connect-admin.php';

add_action( 'rest_api_init', array( 'Presser_Connect_Rest', 'register_routes' ) );

if ( is_admin() ) {
	Presser_Connect_Admin::init();
}
