<?php
/**
 * Update emails (0.30.0): switch off the emails WordPress sends about
 * updates. Off by default (the emails are suppressed) until the dashboard
 * turns them back on, so a site without the setting stored follows the default.
 *
 * Covers the automatic update result emails for WordPress core, plugins and
 * themes, the "a new WordPress version is available" notice and the
 * automatic updater's debug email.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Update_Emails {

	/** Holds "allow" when the dashboard has turned the emails back on. Anything else, or unset, suppresses them. */
	const OPTION = 'kontrolwp_connect_update_emails';

	/** The WordPress filters that decide whether an update email is sent. */
	const FILTERS = array(
		'auto_core_update_send_email',
		'auto_plugin_update_send_email',
		'auto_theme_update_send_email',
		'send_core_update_notification_email',
		'automatic_updates_send_debug_email',
	);

	public static function boot() {
		foreach ( self::FILTERS as $filter ) {
			add_filter( $filter, array( __CLASS__, 'filter' ), 99 );
		}
	}

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/update-emails'      => 'report_route',
			'/update-emails/save' => 'save_route',
		) as $path => $method ) {
			register_rest_route(
				$ns,
				$path,
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, $method ),
					'permission_callback' => $auth,
				)
			);
		}
	}

	/* ---- Pure helper (tested outside WordPress) ---- */

	/** Whether update emails are suppressed, given the stored value. The default (nothing stored) is suppressed. */
	public static function suppressed( $stored ) {
		return 'allow' !== $stored;
	}

	/* ---- WordPress ---- */

	public static function filter( $send ) {
		return self::suppressed( get_option( self::OPTION, '' ) ) ? false : $send;
	}

	public static function report() {
		return array( 'disabled' => self::suppressed( get_option( self::OPTION, '' ) ) );
	}

	public static function report_route() {
		return self::report();
	}

	public static function save_route( $request ) {
		$body = $request->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['disabled'] ) || ! is_bool( $body['disabled'] ) ) {
			return new WP_Error( 'kontrolwp_invalid_update_emails', 'Send disabled as true or false.', array( 'status' => 400 ) );
		}
		update_option( self::OPTION, $body['disabled'] ? 'disable' : 'allow', false );
		return self::report();
	}
}
