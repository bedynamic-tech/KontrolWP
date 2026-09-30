<?php
/**
 * Magic Login: the dashboard asks for a one-time link (a signed request),
 * and opening that link signs the browser in as the administrator the owner
 * chose in Presser. A link works once, for one minute, and only while that
 * user is still an administrator.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Login {

	const ACTION        = 'presser_login';
	const OPTION_PREFIX = 'presser_connect_login_';
	const LIFETIME      = 60;

	public static function init() {
		add_action( 'login_form_' . self::ACTION, array( __CLASS__, 'consume' ) );
	}

	/** Users who may run the site, for the dashboard's Magic Login setting. */
	public static function admins() {
		$users = get_users(
			array(
				'capability' => 'manage_options',
				'orderby'    => 'display_name',
				'number'     => 200,
			)
		);
		$admins = array();
		foreach ( $users as $user ) {
			$admins[] = array(
				'id'           => (int) $user->ID,
				'login'        => $user->user_login,
				'display_name' => $user->display_name,
			);
		}
		return array( 'admins' => $admins );
	}

	/**
	 * Create a one-time login link for an administrator.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function create( $request ) {
		$user = get_userdata( (int) $request['user_id'] );
		if ( ! $user || ! user_can( $user, 'manage_options' ) ) {
			return new WP_Error( 'presser_not_admin', __( 'That user is no longer an administrator on this site. Choose another one for Magic Login.', 'presser-connect' ), array( 'status' => 404 ) );
		}

		self::delete_expired();
		$token = bin2hex( random_bytes( 32 ) );
		// Only a hash is stored, so the database never holds a usable link.
		add_option(
			self::option_name( $token ),
			array(
				'user_id' => (int) $user->ID,
				'expires' => time() + self::LIFETIME,
			),
			'',
			'no'
		);

		return array(
			'url'        => add_query_arg(
				array(
					'action' => self::ACTION,
					'token'  => $token,
				),
				wp_login_url()
			),
			'expires_in' => self::LIFETIME,
		);
	}

	/** Runs on wp-login.php?action=presser_login. */
	public static function consume() {
		nocache_headers();
		header( 'Referrer-Policy: no-referrer' );

		$token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$grant = preg_match( '/^[0-9a-f]{64}$/', $token ) ? get_option( self::option_name( $token ) ) : false;
		// Deleting is what spends the link: when two requests race, only the
		// one whose delete removed the row signs in.
		$spent = is_array( $grant ) && delete_option( self::option_name( $token ) );
		$user  = $spent ? get_userdata( (int) $grant['user_id'] ) : false;

		if ( ! $spent || (int) $grant['expires'] < time() || ! $user || ! user_can( $user, 'manage_options' ) ) {
			wp_die(
				esc_html__( 'This Magic Login link has expired or was already used. Start Magic Login again from Presser.', 'presser-connect' ),
				esc_html__( 'Magic Login', 'presser-connect' ),
				array(
					'response'  => 403,
					'link_url'  => wp_login_url(),
					'link_text' => esc_html__( 'Log in', 'presser-connect' ),
				)
			);
		}

		wp_set_current_user( $user->ID );
		wp_set_auth_cookie( $user->ID, false, is_ssl() );
		// Activity logs and security plugins see this as a normal login.
		do_action( 'wp_login', $user->user_login, $user );
		wp_safe_redirect( admin_url() );
		exit;
	}

	/** Remove every login link, for uninstall. */
	public static function delete_all() {
		global $wpdb;
		$names = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( self::OPTION_PREFIX ) . '%' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		foreach ( $names as $name ) {
			delete_option( $name );
		}
	}

	/** Unused links would otherwise stay in the options table. */
	private static function delete_expired() {
		global $wpdb;
		$names = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s LIMIT 50", $wpdb->esc_like( self::OPTION_PREFIX ) . '%' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		foreach ( $names as $name ) {
			$grant = get_option( $name );
			if ( ! is_array( $grant ) || (int) $grant['expires'] < time() ) {
				delete_option( $name );
			}
		}
	}

	private static function option_name( $token ) {
		return self::OPTION_PREFIX . hash( 'sha256', $token );
	}
}
