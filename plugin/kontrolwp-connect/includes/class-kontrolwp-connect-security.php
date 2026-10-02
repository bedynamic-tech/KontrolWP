<?php
/**
 * Insecure configuration settings, for the dashboard's Security tab, and the
 * hardening fixes the dashboard can switch on (0.13.0). Reporting changes
 * nothing. A fix is saved as an option and applied each time the plugin loads
 * (hooks, constants) or when it is switched on (files), and switching it off
 * puts everything back.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Security {

	const OPTION = 'kontrolwp_connect_hardening';

	/** The fixes the dashboard can switch on, in the order it lists them. */
	const FIXES = array( 'directory_listing', 'generator', 'rsd', 'wlw', 'db_errors', 'php_errors', 'readme', 'file_edit', 'xmlrpc' );

	/** What the index.php put in each directory says; only a file with exactly this is ever removed. */
	const INDEX_CONTENT = "<?php\n// Silence is golden.\n";

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
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/security/fixes',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'set_fixes' ),
				'permission_callback' => $auth,
				'args'                => array(
					'ids'     => array(
						'type'     => 'array',
						'required' => true,
						'items'    => array(
							'type' => 'string',
							'enum' => self::FIXES,
						),
					),
					'enabled' => array(
						'type'     => 'boolean',
						'required' => true,
					),
				),
			)
		);
	}

	/** The fixes switched on in the dashboard. */
	private static function enabled() {
		$saved = get_option( self::OPTION, array() );
		return is_array( $saved ) ? array_values( array_intersect( self::FIXES, $saved ) ) : array();
	}

	/** Hook the switched-on fixes in. Runs every time the plugin loads. */
	public static function boot() {
		$on = self::enabled();
		if ( in_array( 'generator', $on, true ) ) {
			remove_action( 'wp_head', 'wp_generator' );
			add_filter( 'the_generator', '__return_empty_string' );
		}
		if ( in_array( 'rsd', $on, true ) ) {
			remove_action( 'wp_head', 'rsd_link' );
		}
		if ( in_array( 'wlw', $on, true ) ) {
			remove_action( 'wp_head', 'wlwmanifest_link' );
		}
		if ( in_array( 'db_errors', $on, true ) ) {
			add_action( 'init', array( __CLASS__, 'hide_db_errors' ), 0 );
		}
		if ( in_array( 'php_errors', $on, true ) ) {
			@ini_set( 'display_errors', '0' ); // phpcs:ignore WordPress.PHP.IniSet.display_errors_Blacklisted,WordPress.PHP.NoSilencedErrors.Discouraged
			add_action( 'init', array( __CLASS__, 'hide_php_errors' ), 0 );
		}
		if ( in_array( 'file_edit', $on, true ) && ! defined( 'DISALLOW_FILE_EDIT' ) ) {
			define( 'DISALLOW_FILE_EDIT', true );
		}
		if ( in_array( 'xmlrpc', $on, true ) ) {
			add_filter( 'xmlrpc_enabled', '__return_false' );
		}
		if ( in_array( 'readme', $on, true ) || in_array( 'directory_listing', $on, true ) ) {
			// A core update puts readme.html back, and a new upload folder needs its index.php.
			add_action( 'admin_init', array( __CLASS__, 'apply_files' ) );
		}
	}

	public static function hide_db_errors() {
		global $wpdb;
		$wpdb->hide_errors();
		$wpdb->suppress_errors( true );
	}

	public static function hide_php_errors() {
		@ini_set( 'display_errors', '0' ); // phpcs:ignore WordPress.PHP.IniSet.display_errors_Blacklisted,WordPress.PHP.NoSilencedErrors.Discouraged
	}

	/** The directories that get an index.php so a web server cannot list them. */
	private static function index_dirs() {
		$uploads = wp_get_upload_dir();
		$dirs    = array( WP_CONTENT_DIR, WP_PLUGIN_DIR, get_theme_root(), isset( $uploads['basedir'] ) ? $uploads['basedir'] : '' );
		return array_values( array_filter( array_unique( $dirs ), 'is_dir' ) );
	}

	/** Do the work that lives in files: readme.html and the index.php files. */
	public static function apply_files() {
		$on = self::enabled();
		if ( in_array( 'readme', $on, true ) && file_exists( ABSPATH . 'readme.html' ) && is_writable( ABSPATH . 'readme.html' ) ) {
			@unlink( ABSPATH . 'readme.html' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink,WordPress.PHP.NoSilencedErrors.Discouraged
		}
		if ( in_array( 'directory_listing', $on, true ) ) {
			foreach ( self::index_dirs() as $dir ) {
				$file = trailingslashit( $dir ) . 'index.php';
				if ( ! file_exists( $file ) && ! file_exists( trailingslashit( $dir ) . 'index.html' ) && is_writable( $dir ) ) {
					@file_put_contents( $file, self::INDEX_CONTENT ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents,WordPress.PHP.NoSilencedErrors.Discouraged
				}
			}
		}
	}

	/** Remove the index.php files this plugin wrote, and only those. */
	private static function remove_index_files() {
		foreach ( self::index_dirs() as $dir ) {
			$file = trailingslashit( $dir ) . 'index.php';
			if ( file_exists( $file ) && self::INDEX_CONTENT === file_get_contents( $file ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
				@unlink( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink,WordPress.PHP.NoSilencedErrors.Discouraged
			}
		}
	}

	/** Whether the protection is in effect now, whether this plugin or something else put it there. */
	private static function applied( $id ) {
		global $wpdb;
		switch ( $id ) {
			case 'directory_listing':
				foreach ( self::index_dirs() as $dir ) {
					$dir = trailingslashit( $dir );
					if ( ! file_exists( $dir . 'index.php' ) && ! file_exists( $dir . 'index.html' ) ) {
						return false;
					}
				}
				return true;
			case 'generator':
				return false === has_action( 'wp_head', 'wp_generator' );
			case 'rsd':
				return false === has_action( 'wp_head', 'rsd_link' );
			case 'wlw':
				return false === has_action( 'wp_head', 'wlwmanifest_link' );
			case 'db_errors':
				return ! $wpdb->show_errors;
			case 'php_errors':
				return ! filter_var( ini_get( 'display_errors' ), FILTER_VALIDATE_BOOLEAN );
			case 'readme':
				return ! file_exists( ABSPATH . 'readme.html' );
			case 'file_edit':
				return defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT;
			case 'xmlrpc':
				return ! apply_filters( 'xmlrpc_enabled', true );
		}
		return false;
	}

	/** Each fix's state: switched on here, and in effect on the site. */
	private static function states() {
		$on     = self::enabled();
		$states = array();
		foreach ( self::FIXES as $id ) {
			$states[ $id ] = array(
				'enabled' => in_array( $id, $on, true ),
				'applied' => self::applied( $id ),
			);
		}
		return $states;
	}

	/** Switch fixes on or off. Hooks take effect on the next request; files change now. */
	public static function set_fixes( $request ) {
		$ids     = array_values( array_intersect( self::FIXES, (array) $request->get_param( 'ids' ) ) );
		$enabled = (bool) $request->get_param( 'enabled' );
		$saved   = self::enabled();
		$saved   = $enabled ? array_unique( array_merge( $saved, $ids ) ) : array_diff( $saved, $ids );
		// Autoloaded, so reading it at startup costs no query of its own.
		update_option( self::OPTION, array_values( $saved ), true );
		if ( $enabled ) {
			self::apply_files();
		} elseif ( in_array( 'directory_listing', $ids, true ) ) {
			self::remove_index_files();
		}
		return array( 'fixes' => self::states() );
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
			'fixes'              => self::states(),
		);
	}
}
