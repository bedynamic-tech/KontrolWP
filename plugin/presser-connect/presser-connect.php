<?php
/**
 * Plugin Name:       Presser Connect
 * Plugin URI:        https://github.com/bedynamic-tech/Presser
 * Description:       Connects this site to your Presser dashboard so you can see and act on updates and comments across all your sites.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Presser
 * Text Domain:       presser-connect
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
