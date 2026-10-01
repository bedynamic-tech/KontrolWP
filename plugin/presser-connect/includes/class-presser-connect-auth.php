<?php
/**
 * Owns this site's Connection Key and verifies that REST requests were signed
 * by the KontrolWP dashboard that holds it.
 *
 * This is the PHP half of src/shared/protocol.ts in the KontrolWP repository;
 * change both together. The dashboard signs
 *
 *     presser-v1 \n METHOD \n ROUTE \n TIMESTAMP \n NONCE \n sha256_hex(BODY)
 *
 * with HMAC-SHA256 and the secret from this site's Connection Key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Auth {

	const OPTION           = 'presser_connect';
	const LAST_SEEN_OPTION = 'presser_connect_last_seen';
	const PROTOCOL         = 'presser-v1';
	const KEY_PREFIX       = 'presser2.';
	const MAX_SKEW         = 300;

	/**
	 * The stored key, or null before one exists.
	 *
	 * @return array{key_id:string,secret:string,created_at:int}|null
	 */
	public static function credentials() {
		$stored = get_option( self::OPTION );
		if ( ! is_array( $stored ) || empty( $stored['key_id'] ) || empty( $stored['secret'] ) ) {
			return null;
		}
		return $stored;
	}

	/**
	 * Create a key when none exists yet (on activation, or on first view of
	 * the settings page). Keys from KontrolWP Connect 0.1 are replaced.
	 */
	public static function ensure_credentials() {
		$credentials = self::credentials();
		return $credentials ? $credentials : self::regenerate();
	}

	/**
	 * Replace the key. KontrolWP stops reaching this site until the owner pastes
	 * the new Connection Key into the dashboard.
	 */
	public static function regenerate() {
		$credentials = array(
			'key_id'     => self::base64url_encode( random_bytes( 9 ) ),
			'secret'     => self::base64url_encode( random_bytes( 32 ) ),
			'created_at' => time(),
		);
		update_option( self::OPTION, $credentials, false );
		delete_option( self::LAST_SEEN_OPTION );
		return $credentials;
	}

	/**
	 * What the owner copies into KontrolWP, next to the site's address: the key
	 * id and the secret. Treat it like a password.
	 */
	public static function connection_key( $credentials = null ) {
		$credentials = $credentials ? $credentials : self::ensure_credentials();
		$json        = wp_json_encode(
			array(
				'i' => $credentials['key_id'],
				'k' => $credentials['secret'],
			)
		);
		return self::KEY_PREFIX . self::base64url_encode( $json );
	}

	/**
	 * REST permission callback: true when the request carries a valid signature.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return true|WP_Error
	 */
	public static function verify( $request ) {
		$credentials = self::credentials();
		if ( ! $credentials ) {
			return self::deny( __( 'KontrolWP Connect has no Connection Key yet. Open Settings, KontrolWP Connect on this site.', 'presser-connect' ) );
		}

		$key_id    = (string) $request->get_header( 'X-Presser-Key-Id' );
		$timestamp = (string) $request->get_header( 'X-Presser-Timestamp' );
		$nonce     = (string) $request->get_header( 'X-Presser-Nonce' );
		$signature = (string) $request->get_header( 'X-Presser-Signature' );

		if ( '' === $signature || ! ctype_digit( $timestamp ) || ! preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $nonce ) ) {
			return self::deny( __( 'This request was not signed by KontrolWP.', 'presser-connect' ) );
		}
		if ( ! hash_equals( (string) $credentials['key_id'], $key_id ) ) {
			return self::deny( __( 'This site has a newer Connection Key. Copy it from Settings, KontrolWP Connect and paste it into KontrolWP.', 'presser-connect' ) );
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
		$expected = self::sign( $credentials['secret'], $canonical );
		if ( ! hash_equals( $expected, $signature ) ) {
			return self::deny( __( 'The signature did not match. Copy the Connection Key from Settings, KontrolWP Connect and paste it into KontrolWP again.', 'presser-connect' ) );
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
