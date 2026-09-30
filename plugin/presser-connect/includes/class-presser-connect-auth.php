<?php
/**
 * Verifies that a REST request was signed by the Presser dashboard.
 *
 * This is the PHP half of src/shared/protocol.ts in the Presser repository;
 * change both together. The dashboard signs
 *
 *     presser-v1 \n METHOD \n ROUTE \n TIMESTAMP \n NONCE \n sha256_hex(BODY)
 *
 * with HMAC-SHA256 and the per-site secret from the Connection Key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Auth {

	const OPTION           = 'presser_connect';
	const LAST_SEEN_OPTION = 'presser_connect_last_seen';
	const PROTOCOL         = 'presser-v1';
	const KEY_PREFIX       = 'presser1.';
	const MAX_SKEW         = 300;

	/**
	 * The stored connection, or null when the site is not connected.
	 *
	 * @return array{site_id:int,secret:string,dashboard:string,connected_at:int}|null
	 */
	public static function connection() {
		$connection = get_option( self::OPTION );
		if ( ! is_array( $connection ) || empty( $connection['site_id'] ) || empty( $connection['secret'] ) ) {
			return null;
		}
		return $connection;
	}

	/**
	 * Decode a Connection Key pasted by the site owner.
	 *
	 * @return array{site_id:int,secret:string,dashboard:string}|WP_Error
	 */
	public static function parse_connection_key( $key ) {
		$key = trim( (string) $key );
		if ( 0 !== strpos( $key, self::KEY_PREFIX ) ) {
			return new WP_Error( 'presser_invalid_key', __( 'That is not a Presser Connection Key. Copy it again from your dashboard.', 'presser-connect' ) );
		}
		$json = self::base64url_decode( substr( $key, strlen( self::KEY_PREFIX ) ) );
		$data = is_string( $json ) ? json_decode( $json, true ) : null;
		if ( ! is_array( $data ) || ! isset( $data['s'], $data['k'], $data['d'] ) || ! is_int( $data['s'] ) ) {
			return new WP_Error( 'presser_invalid_key', __( 'The Connection Key is incomplete. Copy it again from your dashboard.', 'presser-connect' ) );
		}
		$secret = self::base64url_decode( (string) $data['k'] );
		if ( ! is_string( $secret ) || strlen( $secret ) < 32 ) {
			return new WP_Error( 'presser_invalid_key', __( 'The Connection Key is incomplete. Copy it again from your dashboard.', 'presser-connect' ) );
		}
		$dashboard = esc_url_raw( (string) $data['d'], array( 'https', 'http' ) );
		return array(
			'site_id'   => $data['s'],
			'secret'    => (string) $data['k'],
			'dashboard' => $dashboard,
		);
	}

	/**
	 * REST permission callback: true when the request carries a valid signature.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return true|WP_Error
	 */
	public static function verify( $request ) {
		$connection = self::connection();
		if ( ! $connection ) {
			return self::deny( __( 'Presser Connect is installed but not connected. Paste the Connection Key under Settings, Presser Connect.', 'presser-connect' ) );
		}

		$site_id   = (string) $request->get_header( 'X-Presser-Site' );
		$timestamp = (string) $request->get_header( 'X-Presser-Timestamp' );
		$nonce     = (string) $request->get_header( 'X-Presser-Nonce' );
		$signature = (string) $request->get_header( 'X-Presser-Signature' );

		if ( '' === $signature || ! ctype_digit( $timestamp ) || ! preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $nonce ) ) {
			return self::deny( __( 'This request was not signed by Presser.', 'presser-connect' ) );
		}
		if ( (string) $connection['site_id'] !== $site_id ) {
			return self::deny( __( 'This site is connected to a different Presser site entry. Paste the latest Connection Key.', 'presser-connect' ) );
		}
		if ( abs( time() - (int) $timestamp ) > self::MAX_SKEW ) {
			return self::deny( __( 'The request expired. Check that this server\'s clock is correct.', 'presser-connect' ) );
		}

		$canonical = implode(
			"\n",
			array(
				self::PROTOCOL,
				strtoupper( $request->get_method() ),
				$request->get_route(),
				$timestamp,
				$nonce,
				hash( 'sha256', (string) $request->get_body() ),
			)
		);
		$expected = self::sign( $connection['secret'], $canonical );
		if ( ! hash_equals( $expected, $signature ) ) {
			return self::deny( __( 'The signature did not match. Paste the latest Connection Key from your dashboard.', 'presser-connect' ) );
		}

		// Checked after the signature so unsigned requests cannot fill the store.
		$nonce_key = 'presser_nonce_' . md5( $nonce );
		if ( false !== get_transient( $nonce_key ) ) {
			return self::deny( __( 'This request was already used.', 'presser-connect' ) );
		}
		set_transient( $nonce_key, 1, 2 * self::MAX_SKEW );

		$last_seen = (int) get_option( self::LAST_SEEN_OPTION, 0 );
		if ( time() - $last_seen > 300 ) {
			update_option( self::LAST_SEEN_OPTION, time(), false );
		}
		return true;
	}

	/**
	 * HMAC-SHA256 of the canonical string, base64url encoded without padding.
	 */
	public static function sign( $secret, $canonical ) {
		return self::base64url_encode( hash_hmac( 'sha256', $canonical, self::base64url_decode( $secret ), true ) );
	}

	public static function base64url_encode( $bytes ) {
		return rtrim( strtr( base64_encode( $bytes ), '+/', '-_' ), '=' );
	}

	public static function base64url_decode( $value ) {
		$value = strtr( (string) $value, '-_', '+/' );
		$pad   = strlen( $value ) % 4;
		if ( $pad ) {
			$value .= str_repeat( '=', 4 - $pad );
		}
		return base64_decode( $value, true );
	}

	private static function deny( $message ) {
		return new WP_Error( 'presser_unauthorized', $message, array( 'status' => 401 ) );
	}
}
