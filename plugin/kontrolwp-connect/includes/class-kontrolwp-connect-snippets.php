<?php
/**
 * Code snippets (0.29.0): analytics codes, tracking pixels and other small
 * pieces of HTML or JavaScript that the owner wants printed in the head, at
 * the start of the body or in the footer of the public site.
 *
 * Snippets are written only from the dashboard, through the signed REST
 * routes, and are printed exactly as written. They are never printed in the
 * admin, in feeds or in the customizer preview, and by default not for
 * logged-in editors, so the owner's own visits do not count as traffic.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Snippets {

	/** The snippets. Not autoloaded: it can be large and is read only while one is switched on. */
	const OPTION = 'kontrolwp_connect_snippets';
	/** How many snippets are switched on. Autoloaded and tiny, so a site with none costs no extra query. */
	const ACTIVE_OPTION = 'kontrolwp_connect_snippets_active';

	const MAX_SNIPPETS = 50;
	const MAX_CODE     = 30000;
	const MAX_NAME     = 100;
	const MAX_PATHS    = 20;
	const MAX_PATH     = 200;

	const LOCATIONS = array( 'head', 'body_start', 'footer' );
	const SCOPES    = array( 'all', 'only', 'except' );

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/snippets'      => 'report_route',
			'/snippets/save' => 'save_route',
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

	/* ---- Pure helpers (tested outside WordPress) ---- */

	/** A page path to match: starts with a slash, no query or fragment, an optional trailing * for "and everything under it". */
	public static function clean_path( $value ) {
		$value = trim( (string) $value );
		$value = preg_split( '/[?#]/', $value )[0];
		if ( '' === $value ) {
			return '';
		}
		if ( '/' !== $value[0] ) {
			$value = '/' . $value;
		}
		if ( strlen( $value ) > self::MAX_PATH || preg_match( '/[\x00-\x1F\x7F\s]/', $value ) ) {
			return '';
		}
		return $value;
	}

	/** Whether a request path matches one pattern: exact (a trailing slash does not matter) or a prefix when the pattern ends in *. */
	public static function path_matches( $path, $pattern ) {
		$path = '/' . ltrim( (string) $path, '/' );
		if ( '*' === substr( $pattern, -1 ) ) {
			$prefix = substr( $pattern, 0, -1 );
			return '' === $prefix || 0 === strpos( $path, $prefix );
		}
		return untrailingslashit_( $path ) === untrailingslashit_( $pattern );
	}

	/** Whether a snippet should print on this request path. */
	public static function applies( $snippet, $path ) {
		if ( empty( $snippet['enabled'] ) ) {
			return false;
		}
		if ( 'all' === $snippet['scope'] || empty( $snippet['paths'] ) ) {
			return true;
		}
		$hit = false;
		foreach ( $snippet['paths'] as $pattern ) {
			if ( self::path_matches( $path, $pattern ) ) {
				$hit = true;
				break;
			}
		}
		return 'only' === $snippet['scope'] ? $hit : ! $hit;
	}

	/** One snippet from untrusted input: only known keys of the right shape. The code itself is kept exactly as written. */
	public static function clean_snippet( $input ) {
		$input = is_array( $input ) ? $input : array();
		$name  = isset( $input['name'] ) && is_string( $input['name'] ) ? trim( preg_replace( '/[\x00-\x1F\x7F]/', ' ', $input['name'] ) ) : '';
		$code  = isset( $input['code'] ) && is_string( $input['code'] ) ? str_replace( "\0", '', $input['code'] ) : '';
		$paths = array();
		if ( isset( $input['paths'] ) && is_array( $input['paths'] ) ) {
			foreach ( $input['paths'] as $path ) {
				$clean = is_string( $path ) ? self::clean_path( $path ) : '';
				if ( '' !== $clean && ! in_array( $clean, $paths, true ) ) {
					$paths[] = $clean;
				}
			}
			$paths = array_slice( $paths, 0, self::MAX_PATHS );
		}
		return array(
			'id'       => isset( $input['id'] ) && is_string( $input['id'] ) && preg_match( '/^[A-Za-z0-9]{6,32}$/', $input['id'] ) ? $input['id'] : '',
			'name'     => function_exists( 'mb_substr' ) ? mb_substr( $name, 0, self::MAX_NAME ) : substr( $name, 0, self::MAX_NAME ),
			'code'     => $code,
			'location' => isset( $input['location'] ) && in_array( $input['location'], self::LOCATIONS, true ) ? $input['location'] : 'head',
			'enabled'  => ! empty( $input['enabled'] ),
			'scope'    => isset( $input['scope'] ) && in_array( $input['scope'], self::SCOPES, true ) ? $input['scope'] : 'all',
			'paths'    => $paths,
		);
	}

	/** An error message for a snippet that cannot be saved, or an empty string. */
	public static function snippet_error( $snippet ) {
		$label = '' !== $snippet['name'] ? '"' . $snippet['name'] . '"' : 'A snippet';
		if ( '' === $snippet['name'] ) {
			return 'Every snippet needs a name.';
		}
		if ( '' === trim( $snippet['code'] ) ) {
			return $label . ' has no code.';
		}
		if ( strlen( $snippet['code'] ) > self::MAX_CODE ) {
			return $label . ' is longer than ' . self::MAX_CODE . ' characters.';
		}
		return '';
	}

	/** Settings from untrusted input. Snippets without a usable id get one from $make_id. */
	public static function clean( $input, $make_id ) {
		$input    = is_array( $input ) ? $input : array();
		$snippets = array();
		$seen     = array();
		if ( isset( $input['snippets'] ) && is_array( $input['snippets'] ) ) {
			foreach ( array_slice( array_values( $input['snippets'] ), 0, self::MAX_SNIPPETS ) as $raw ) {
				$snippet = self::clean_snippet( $raw );
				if ( '' === $snippet['id'] || isset( $seen[ $snippet['id'] ] ) ) {
					do {
						$snippet['id'] = (string) call_user_func( $make_id );
					} while ( isset( $seen[ $snippet['id'] ] ) );
				}
				$seen[ $snippet['id'] ] = true;
				$snippets[]             = $snippet;
			}
		}
		return array(
			'skip_editors' => ! isset( $input['skip_editors'] ) || ! empty( $input['skip_editors'] ),
			'snippets'     => $snippets,
		);
	}

	/** A comment naming the snippet in the page source, safe inside an HTML comment. */
	public static function label( $name ) {
		$name = preg_replace( '/[^A-Za-z0-9 _.]/', '', (string) $name );
		return trim( preg_replace( '/\s+/', ' ', $name ) );
	}

	/** The snippets for one location that apply to the path, in the order they were saved. */
	public static function for_location( $snippets, $location, $path ) {
		$out = array();
		foreach ( $snippets as $snippet ) {
			if ( $snippet['location'] === $location && self::applies( $snippet, $path ) ) {
				$out[] = $snippet;
			}
		}
		return $out;
	}

	/* ---- Storage ---- */

	public static function settings() {
		$saved = get_option( self::OPTION, array() );
		return self::clean( is_array( $saved ) ? $saved : array(), array( __CLASS__, 'new_id' ) );
	}

	public static function new_id() {
		return wp_generate_password( 10, false, false );
	}

	/* ---- Front end ---- */

	public static function boot() {
		if ( (int) get_option( self::ACTIVE_OPTION, 0 ) < 1 ) {
			return;
		}
		add_action( 'wp_head', array( __CLASS__, 'print_head' ), 99 );
		add_action( 'wp_body_open', array( __CLASS__, 'print_body_start' ), 1 );
		add_action( 'wp_footer', array( __CLASS__, 'print_footer' ), 99 );
	}

	public static function print_head() {
		self::print_location( 'head' );
	}

	public static function print_body_start() {
		self::print_location( 'body_start' );
	}

	public static function print_footer() {
		self::print_location( 'footer' );
	}

	/** The request's path with the site's own folder taken off. */
	private static function request_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/'; // phpcs:ignore WordPress.Security
		$path = '/' . ltrim( (string) wp_parse_url( $uri, PHP_URL_PATH ), '/' );
		$base = wp_parse_url( home_url(), PHP_URL_PATH );
		$base = is_string( $base ) ? rtrim( $base, '/' ) : '';
		if ( '' !== $base && 0 === strpos( $path, $base . '/' ) ) {
			$path = substr( $path, strlen( $base ) );
		}
		return $path;
	}

	private static function print_location( $location ) {
		if ( is_admin() || is_feed() || is_robots() || ( function_exists( 'is_customize_preview' ) && is_customize_preview() ) ) {
			return;
		}
		$settings = self::settings();
		if ( $settings['skip_editors'] && is_user_logged_in() && current_user_can( 'edit_posts' ) ) {
			return;
		}
		foreach ( self::for_location( $settings['snippets'], $location, self::request_path() ) as $snippet ) {
			$label = self::label( $snippet['name'] );
			// Printed as written: snippets are authored by the site's administrators through the dashboard.
			echo "\n<!-- KontrolWP snippet: " . $label . " -->\n" . $snippet['code'] . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
		}
	}

	/* ---- Dashboard routes ---- */

	public static function report() {
		$settings = self::settings();
		return array(
			'settings' => $settings,
			'limits'   => array(
				'snippets' => self::MAX_SNIPPETS,
				'code'     => self::MAX_CODE,
				'name'     => self::MAX_NAME,
				'paths'    => self::MAX_PATHS,
			),
		);
	}

	public static function report_route() {
		return self::report();
	}

	public static function save_route( $request ) {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		if ( isset( $body['snippets'] ) && is_array( $body['snippets'] ) && count( $body['snippets'] ) > self::MAX_SNIPPETS ) {
			return new WP_Error( 'kontrolwp_invalid_snippets', 'A site can have up to ' . self::MAX_SNIPPETS . ' snippets.', array( 'status' => 400 ) );
		}
		$new = self::clean( $body, array( __CLASS__, 'new_id' ) );
		foreach ( $new['snippets'] as $snippet ) {
			$error = self::snippet_error( $snippet );
			if ( '' !== $error ) {
				return new WP_Error( 'kontrolwp_invalid_snippet', $error, array( 'status' => 400 ) );
			}
		}
		update_option( self::OPTION, $new, false );
		$active = 0;
		foreach ( $new['snippets'] as $snippet ) {
			if ( $snippet['enabled'] ) {
				++$active;
			}
		}
		update_option( self::ACTIVE_OPTION, $active, true );
		return self::report();
	}
}

/** untrailingslashit for the pure helpers, which run outside WordPress. */
function untrailingslashit_( $value ) {
	return '/' === $value ? '/' : rtrim( $value, '/' );
}
