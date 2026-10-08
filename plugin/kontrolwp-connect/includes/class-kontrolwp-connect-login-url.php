<?php
/**
 * Custom login URL (0.31.0): serve the WordPress login form at an address the
 * owner chooses, and treat wp-login.php and the logged-out wp-admin as pages
 * that do not exist. It works like the WPS Hide Login plugin, and the two
 * cannot run together.
 *
 * Nothing in WordPress is changed or moved. The only thing stored is one
 * option, so turning this off, clearing the address, deactivating the plugin
 * or defining KONTROLWP_DISABLE_LOGIN_URL as true in wp-config.php puts the
 * normal wp-login.php back at once, with nothing to clean up.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Login_URL {

	/** Holds array( 'enabled' => bool, 'slug' => string, 'redirect' => '404'|'home' ). */
	const OPTION = 'kontrolwp_connect_login_url';

	const MIN_SLUG = 3;
	const MAX_SLUG = 60;

	/** Names that WordPress, the web server or a browser already use, so they cannot be the login address. */
	const RESERVED = array(
		'admin', 'administrator', 'atom', 'attachment', 'author', 'category', 'comments', 'dashboard', 'embed', 'favicon-ico', 'feed',
		'index', 'index-php', 'license', 'login', 'page', 'rdf', 'readme', 'register', 'robots-txt', 'rss', 'rss2', 'search', 'sitemap',
		'sitemap-xml', 'tag', 'trackback', 'wp', 'wp-activate', 'wp-admin', 'wp-blog-header', 'wp-comments-post', 'wp-config', 'wp-content',
		'wp-cron', 'wp-includes', 'wp-json', 'wp-links-opml', 'wp-load', 'wp-login', 'wp-login-php', 'wp-mail', 'wp-register', 'wp-settings',
		'wp-signup', 'wp-sitemap', 'wp-trackback', 'xmlrpc', 'xmlrpc-php',
	);

	/** Plugins that also move or hide the login page, by plugin file. Both cannot run at once. */
	const CONFLICTS = array(
		'wps-hide-login/wps-hide-login.php'              => 'WPS Hide Login',
		'wps-hide-login-pro/wps-hide-login-pro.php'      => 'WPS Hide Login Pro',
		'rename-wp-login/rename-wp-login.php'            => 'Rename wp-login.php',
		'hide-login-page/hide-login-page.php'            => 'Hide Login Page',
		'change-wp-admin-login/change-wp-admin-login.php' => 'Change wp-admin login',
		'lws-hide-login/lws-hide-login.php'              => 'LWS Hide Login',
	);

	/** What this request is, decided early and acted on once WordPress has loaded: '', 'serve' or 'block'. */
	private static $mode = '';

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/login-url'      => 'report_route',
			'/login-url/save' => 'save_route',
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

	/** A login address as WordPress would store it in a URL: lower case letters, digits, hyphens and underscores. */
	public static function normalize_slug( $value ) {
		$value = strtolower( trim( (string) $value ) );
		$value = trim( $value, '/ ' );
		return preg_replace( '/[^a-z0-9_-]+/', '-', $value );
	}

	/** Why a login address cannot be used, or '' when it can. Checks only what needs no WordPress. */
	public static function slug_error( $slug ) {
		$slug = (string) $slug;
		if ( '' === trim( $slug, '-_' ) ) {
			return 'Enter the address for the login page, such as my-login.';
		}
		if ( strlen( $slug ) < self::MIN_SLUG ) {
			return 'The login address needs at least ' . self::MIN_SLUG . ' characters.';
		}
		if ( strlen( $slug ) > self::MAX_SLUG ) {
			return 'The login address can be up to ' . self::MAX_SLUG . ' characters.';
		}
		if ( in_array( $slug, self::RESERVED, true ) || in_array( str_replace( '_', '-', $slug ), self::RESERVED, true ) ) {
			return 'WordPress or the web server already uses "' . $slug . '". Choose another address.';
		}
		return '';
	}

	/** The request path below the site's home address, with no slashes at the ends, as WordPress would route it. */
	public static function relative_path( $request_uri, $home_path ) {
		$path = (string) parse_url( (string) $request_uri, PHP_URL_PATH );
		$path = rawurldecode( $path );
		$home = trim( (string) $home_path, '/' );
		$path = ltrim( $path, '/' );
		if ( '' !== $home && ( $path === $home || 0 === strpos( $path, $home . '/' ) ) ) {
			$path = substr( $path, strlen( $home ) );
		}
		$path = trim( $path, '/' );
		if ( 0 === strpos( $path, 'index.php/' ) ) {
			$path = substr( $path, strlen( 'index.php/' ) );
		}
		return strtolower( trim( $path, '/' ) );
	}

	/** Whether a request is for the custom login address, as a path or, without pretty permalinks, as a ?slug. */
	public static function is_login_request( $relative, $slug, $query_keys ) {
		if ( '' === $slug ) {
			return false;
		}
		return $relative === $slug || in_array( $slug, $query_keys, true );
	}

	/**
	 * Direct wp-login.php requests that still work: a password-protected post's
	 * form, and a Magic Login link made before this was switched on.
	 */
	public static function direct_allowed( $get, $post ) {
		$action = isset( $get['action'] ) ? (string) $get['action'] : '';
		if ( 'postpass' === $action && isset( $post['post_password'] ) ) {
			return true;
		}
		return 'kontrolwp_login' === $action && isset( $get['token'] ) && 1 === preg_match( '/^[0-9a-f]{64}$/', (string) $get['token'] );
	}

	/** Whether a logged-out request to this wp-admin file may carry on, because WordPress or the page needs it signed out. */
	public static function admin_open( $pagenow ) {
		return in_array( (string) $pagenow, array( 'admin-ajax.php', 'admin-post.php', 'load-styles.php', 'load-scripts.php', 'install.php', 'upgrade.php', 'repair.php' ), true );
	}

	/** A link to wp-login.php made to point at the custom login URL instead, keeping its query. Other links are returned as they are. */
	public static function rewrite_url( $url, $login_url ) {
		$url = (string) $url;
		if ( 1 !== preg_match( '#/wp-login\.php(\?|$)#', $url ) || false !== strpos( $url, 'action=postpass' ) ) {
			return $url;
		}
		$query = (string) parse_url( $url, PHP_URL_QUERY );
		return '' === $query ? $login_url : $login_url . ( false === strpos( $login_url, '?' ) ? '?' : '&' ) . $query;
	}

	/** The saved setting with every field present and clean. */
	public static function clean( $stored ) {
		$stored = is_array( $stored ) ? $stored : array();
		return array(
			'enabled'  => ! empty( $stored['enabled'] ),
			'slug'     => isset( $stored['slug'] ) ? self::normalize_slug( $stored['slug'] ) : '',
			'redirect' => isset( $stored['redirect'] ) && 'home' === $stored['redirect'] ? 'home' : '404',
		);
	}

	/* ---- WordPress ---- */

	/** Which of the other login-hiding plugins are active here. */
	public static function conflicts() {
		$active = (array) get_option( 'active_plugins', array() );
		if ( is_multisite() ) {
			$active = array_merge( $active, array_keys( (array) get_site_option( 'active_sitewide_plugins', array() ) ) );
		}
		$found = array();
		foreach ( self::CONFLICTS as $file => $name ) {
			if ( in_array( $file, $active, true ) ) {
				$found[] = $name;
			}
		}
		if ( class_exists( 'WPS\\WPS_Hide_Login\\Plugin' ) && ! in_array( 'WPS Hide Login', $found, true ) ) {
			$found[] = 'WPS Hide Login';
		}
		return $found;
	}

	/** Whether wp-config.php switches this off for good. */
	public static function locked() {
		return defined( 'KONTROLWP_DISABLE_LOGIN_URL' ) && KONTROLWP_DISABLE_LOGIN_URL;
	}

	public static function settings() {
		return self::clean( get_option( self::OPTION, array() ) );
	}

	/** Whether the custom address is in force right now. */
	public static function active() {
		$settings = self::settings();
		return $settings['enabled'] && '' === self::slug_error( $settings['slug'] ) && ! self::locked() && ! self::conflicts();
	}

	/** The custom login URL for a slug. */
	public static function url_for( $slug ) {
		$structure = (string) get_option( 'permalink_structure' );
		if ( '' !== $structure ) {
			// Not user_trailingslashit(): this runs before WordPress has created its rewrite object.
			$url = home_url( $slug );
			return '/' === substr( $structure, -1 ) ? trailingslashit( $url ) : $url;
		}
		return trailingslashit( home_url() ) . '?' . $slug;
	}

	private static function default_url() {
		return trailingslashit( get_option( 'siteurl' ) ) . 'wp-login.php';
	}

	public static function boot() {
		if ( ! self::active() ) {
			return;
		}
		$settings = self::settings();
		$login    = self::url_for( $settings['slug'] );
		$rewrite  = static function ( $url ) use ( $login ) {
			return KontrolWP_Connect_Login_URL::rewrite_url( $url, $login );
		};
		add_filter( 'site_url', $rewrite, 100 );
		add_filter( 'network_site_url', $rewrite, 100 );
		add_filter( 'wp_redirect', $rewrite, 100 );
		// Core sends /login, /admin and /dashboard to the login page, which would give the address away.
		remove_action( 'template_redirect', 'wp_redirect_admin_locations', 1000 );
		add_action( 'plugins_loaded', array( __CLASS__, 'classify' ), 9999 );
		add_action( 'wp_loaded', array( __CLASS__, 'act' ), 1 );
	}

	/** Decide what this request is, before WordPress has loaded enough to act on it. */
	public static function classify() {
		global $pagenow;
		if ( defined( 'WP_CLI' ) || defined( 'DOING_CRON' ) || defined( 'XMLRPC_REQUEST' ) || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
		if ( isset( $_GET['rest_route'] ) || 0 === strpos( ltrim( (string) parse_url( $uri, PHP_URL_PATH ), '/' ), 'wp-json' ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}
		$settings = self::settings();
		$relative = self::relative_path( $uri, parse_url( home_url(), PHP_URL_PATH ) );
		if ( self::is_login_request( $relative, $settings['slug'], array_keys( $_GET ) ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			self::$mode = 'serve';
		} elseif ( 'wp-login.php' === $pagenow && ! self::direct_allowed( $_GET, $_POST ) ) { // phpcs:ignore WordPress.Security.NonceVerification
			self::$mode = 'block';
		}
	}

	/** Once WordPress has loaded: show the login form, or hide the pages that would give it away. */
	public static function act() {
		global $pagenow;
		if ( 'serve' === self::$mode ) {
			// wp-login.php expects these as globals.
			global $error, $interim_login, $action, $user_login;
			$pagenow = 'wp-login.php';
			require_once ABSPATH . 'wp-login.php';
			exit;
		}
		$hide = 'block' === self::$mode;
		if ( ! $hide && is_admin() && ! is_user_logged_in() && ! ( defined( 'DOING_AJAX' ) && DOING_AJAX ) && ! self::admin_open( $pagenow ) ) {
			$hide = true;
		}
		if ( ! $hide ) {
			return;
		}
		$settings = self::settings();
		if ( 'home' === $settings['redirect'] ) {
			wp_safe_redirect( home_url( '/' ) );
			exit;
		}
		global $wp_query;
		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
		if ( ! defined( 'WP_USE_THEMES' ) ) {
			define( 'WP_USE_THEMES', true );
		}
		require_once ABSPATH . WPINC . '/template-loader.php';
		exit;
	}

	public static function report() {
		$settings = self::settings();
		$valid    = '' === self::slug_error( $settings['slug'] );
		return array(
			'enabled'           => $settings['enabled'],
			'slug'              => $settings['slug'],
			'redirect'          => $settings['redirect'],
			'active'            => self::active(),
			'locked'            => self::locked(),
			'conflicts'         => self::conflicts(),
			'login_url'         => $valid ? self::url_for( $settings['slug'] ) : '',
			'default_login_url' => self::default_url(),
		);
	}

	public static function report_route() {
		return self::report();
	}

	/** A reason this slug cannot be used on this site, or ''. */
	private static function site_error( $slug ) {
		global $wpdb;
		$error = self::slug_error( $slug );
		if ( '' !== $error ) {
			return $error;
		}
		if ( file_exists( ABSPATH . $slug ) || file_exists( ABSPATH . $slug . '.php' ) ) {
			return 'A file or folder named "' . $slug . '" already exists on this site. Choose another address.';
		}
		$used = $wpdb->get_var( $wpdb->prepare( "SELECT ID FROM {$wpdb->posts} WHERE post_name = %s AND post_status IN ('publish','future','draft','pending','private') AND post_type NOT IN ('revision','nav_menu_item','customize_changeset','oembed_cache','user_request','wp_global_styles') LIMIT 1", $slug ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
		if ( $used ) {
			return 'A page or post on this site already uses "' . $slug . '". Choose another address.';
		}
		return '';
	}

	public static function save_route( $request ) {
		$body = $request->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['enabled'] ) || ! is_bool( $body['enabled'] ) ) {
			return new WP_Error( 'kontrolwp_invalid_login_url', 'Send enabled as true or false.', array( 'status' => 400 ) );
		}
		$new = self::clean( $body );
		if ( $new['enabled'] ) {
			$found = self::conflicts();
			if ( $found ) {
				return new WP_Error( 'kontrolwp_login_url_conflict', implode( ' and ', $found ) . ' already changes the login page on this site. Deactivate it first, because both cannot run at once.', array( 'status' => 409 ) );
			}
			$error = self::site_error( $new['slug'] );
			if ( '' !== $error ) {
				return new WP_Error( 'kontrolwp_invalid_login_url', $error, array( 'status' => 400 ) );
			}
		}
		update_option( self::OPTION, $new, true );
		return self::report();
	}
}
