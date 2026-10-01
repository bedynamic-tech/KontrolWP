<?php
/**
 * Insecure configuration settings, for the dashboard's Security tab. Read-only:
 * it reports how the site is set up and changes nothing.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Security {

	public static function register_routes( $auth ) {
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/security',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'report' ),
				'permission_callback' => $auth,
			)
		);
	}

	public static function report() {
		return array(
			// Errors and notices printed into pages show visitors file paths and code.
			'debug_display'      => defined( 'WP_DEBUG' ) && WP_DEBUG && ( ! defined( 'WP_DEBUG_DISPLAY' ) || WP_DEBUG_DISPLAY ),
			// With the editor on, one stolen admin login can change any plugin's code.
			'file_edit_allowed'  => ! ( defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT ),
			// "admin" is the first name password guessing tries.
			'admin_user_exists'  => false !== username_exists( 'admin' ),
			// XML-RPC lets a password be guessed hundreds of times in one request.
			'xmlrpc_enabled'     => (bool) apply_filters( 'xmlrpc_enabled', true ),
		);
	}
}
