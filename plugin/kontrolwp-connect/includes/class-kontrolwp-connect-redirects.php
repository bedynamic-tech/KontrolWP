<?php
/**
 * Redirects the dashboard's SEO tab manages (0.16.0): exact, prefix and regex
 * rules answered with 301, 302, 307, 308, 410 or 451, a hit count per rule,
 * and an optional log of the addresses that 404.
 *
 * Rules live in their own table. A request costs nothing when there are no
 * rules and no 404 log; with rules it costs one indexed lookup, plus a short
 * scan of the prefix and regex rules (which are few) only if any exist.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Redirects {

	const DB_OPTION    = 'kontrolwp_connect_redirects_db';
	const STATE_OPTION = 'kontrolwp_connect_redirects_state';
	const DB_VERSION   = '2';

	/** Statuses a rule can answer with. 410 and 451 have no target. */
	const CODES = array( 301, 302, 307, 308, 410, 451 );
	const TYPES = array( 'exact', 'prefix', 'regex' );

	/** What to do when content is deleted or trashed. */
	const DELETE_ACTIONS = array( 'none', '410', '301' );

	const META_AUTO_SOURCE = '_kontrolwp_auto_redirect_source';

	const MAX_RULES    = 5000;
	const MAX_404      = 500;
	const MAX_PER_PAGE = 100;

	public static function register_routes( $auth ) {
		$ns   = KontrolWP_Connect_Rest::NAMESPACE_V1;
		$post = function ( $path, $callback ) use ( $ns, $auth ) {
			register_rest_route(
				$ns,
				$path,
				array(
					'methods'             => 'POST',
					'callback'            => $callback,
					'permission_callback' => $auth,
				)
			);
		};
		$post( '/seo/redirects', array( __CLASS__, 'index' ) );
		$post( '/seo/redirect', array( __CLASS__, 'save' ) );
		$post( '/seo/redirects/bulk', array( __CLASS__, 'bulk' ) );
		$post( '/seo/redirects/import', array( __CLASS__, 'import' ) );
		$post( '/seo/redirects/settings', array( __CLASS__, 'save_settings' ) );
		$post( '/seo/404s', array( __CLASS__, 'not_found_index' ) );
		$post( '/seo/404s/clear', array( __CLASS__, 'not_found_clear' ) );
	}

	/* ---- Pure helpers (tested outside WordPress) ---- */

	/** The path of an address or path: no host, query or fragment, one leading slash, no trailing slash except for the root. */
	public static function normalize_path( $value ) {
		$value = trim( (string) $value );
		if ( preg_match( '#^https?://#i', $value ) ) {
			$path  = parse_url( $value, PHP_URL_PATH );
			$value = is_string( $path ) ? $path : '/';
		}
		$value = preg_replace( '/[?#].*$/', '', $value );
		$value = '/' . ltrim( (string) $value, '/' );
		$value = preg_replace( '#/{2,}#', '/', $value );
		return strlen( $value ) > 1 ? rtrim( $value, '/' ) : '/';
	}

	/** The lower case form used to look an exact rule up. */
	public static function key( $path ) {
		$path = self::normalize_path( $path );
		return function_exists( 'mb_strtolower' ) ? mb_strtolower( $path, 'UTF-8' ) : strtolower( $path );
	}

	/** Whether a regex rule's pattern compiles. */
	public static function regex_ok( $pattern ) {
		if ( '' === $pattern || strlen( $pattern ) > 200 ) {
			return false;
		}
		return false !== @preg_match( self::regex( $pattern ), '' ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
	}

	private static function regex( $pattern ) {
		return '#' . str_replace( '#', '\\#', $pattern ) . '#i';
	}

	/** Whether a redirect target is a full http(s) address or a path on this site. */
	public static function target_ok( $target ) {
		return (bool) preg_match( '#^(https?://[^\s<>"\']+|/[^\s<>"\']*)$#i', $target ) && strlen( $target ) <= 1000;
	}

	/**
	 * A URL as a path on the site: the host, query and the site's own folder
	 * taken off. Empty when the URL is on another host.
	 */
	public static function relative_path( $url, $home ) {
		$u = wp_parse_url( $url );
		$h = wp_parse_url( $home );
		if ( ! is_array( $u ) || ! is_array( $h ) ) {
			return '';
		}
		if ( ! empty( $u['host'] ) && ! empty( $h['host'] ) && strtolower( $u['host'] ) !== strtolower( $h['host'] ) ) {
			return '';
		}
		$path = self::normalize_path( rawurldecode( isset( $u['path'] ) ? $u['path'] : '/' ) );
		$base = isset( $h['path'] ) ? rtrim( $h['path'], '/' ) : '';
		if ( '' !== $base && ( $path === $base || 0 === strpos( $path, $base . '/' ) ) ) {
			$path = self::normalize_path( substr( $path, strlen( $base ) ) );
		}
		return $path;
	}

	/**
	 * A rule from untrusted input: only known fields of the right shape.
	 * Returns array( rule, error ); the error is empty when the rule is fine.
	 */
	public static function clean_rule( $input ) {
		$type = isset( $input['match_type'] ) && in_array( $input['match_type'], self::TYPES, true ) ? $input['match_type'] : 'exact';
		$code = isset( $input['status_code'] ) && in_array( (int) $input['status_code'], self::CODES, true ) ? (int) $input['status_code'] : 301;
		$raw  = isset( $input['source'] ) && is_string( $input['source'] ) ? trim( $input['source'] ) : '';
		if ( '' === $raw ) {
			return array( null, 'Enter the address to redirect from.' );
		}
		if ( 'regex' === $type ) {
			$source = $raw;
			if ( ! self::regex_ok( $source ) ) {
				return array( null, 'That pattern is not a valid regular expression, or it is longer than 200 characters.' );
			}
		} else {
			$source = self::normalize_path( $raw );
			if ( strlen( $source ) > 400 ) {
				return array( null, 'That address is too long.' );
			}
		}
		$target = '';
		if ( 410 !== $code && 451 !== $code ) {
			$target = isset( $input['target'] ) && is_string( $input['target'] ) ? trim( $input['target'] ) : '';
			if ( '' === $target ) {
				return array( null, 'Enter the address to redirect to.' );
			}
			if ( ! self::target_ok( $target ) ) {
				return array( null, 'The target must be a full address starting with http:// or https://, or a path starting with /.' );
			}
			if ( 'exact' === $type && '/' === $target[0] && self::key( $target ) === self::key( $source ) ) {
				return array( null, 'A redirect cannot send an address to itself.' );
			}
		}
		return array(
			array(
				'source'      => $source,
				'match_type'  => $type,
				'target'      => $target,
				'status_code' => $code,
				'enabled'     => ! array_key_exists( 'enabled', $input ) || (bool) $input['enabled'],
			),
			'',
		);
	}

	/**
	 * Whether a rule applies to a path, and what it answers with. Returns
	 * array( target, code ) (an empty target for 410 and 451) or null.
	 */
	public static function match_rule( $rule, $path ) {
		$path = self::normalize_path( $path );
		$code = (int) $rule['status_code'];
		switch ( $rule['match_type'] ) {
			case 'exact':
				if ( self::key( $rule['source'] ) !== self::key( $path ) ) {
					return null;
				}
				return array( $rule['target'], $code );
			case 'prefix':
				$base  = self::key( $rule['source'] );
				$check = self::key( $path );
				if ( '/' !== $base && $check !== $base && 0 !== strpos( $check, $base . '/' ) ) {
					return null;
				}
				$rest = '/' === $base ? ltrim( $path, '/' ) : ltrim( substr( $path, strlen( $base ) ), '/' );
				return array( str_replace( '$1', $rest, $rule['target'] ), $code );
			case 'regex':
				if ( ! preg_match( self::regex( $rule['source'] ), $path, $m ) ) {
					return null;
				}
				$target = $rule['target'];
				foreach ( $m as $i => $group ) {
					if ( $i > 0 ) {
						$target = str_replace( '$' . $i, $group, $target );
					}
				}
				return array( $target, $code );
		}
		return null;
	}

	/* ---- Storage ---- */

	private static function table() {
		global $wpdb;
		return $wpdb->prefix . 'kontrolwp_redirects';
	}

	private static function table_404() {
		global $wpdb;
		return $wpdb->prefix . 'kontrolwp_404s';
	}

	/** Create or update the tables when this plugin version needs it. */
	public static function install() {
		global $wpdb;
		if ( self::DB_VERSION === get_option( self::DB_OPTION ) ) {
			return;
		}
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			'CREATE TABLE ' . self::table() . " (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				source varchar(400) NOT NULL,
				source_key varchar(191) NOT NULL,
				match_type varchar(10) NOT NULL DEFAULT 'exact',
				target varchar(1000) NOT NULL DEFAULT '',
				status_code smallint(5) unsigned NOT NULL DEFAULT 301,
				enabled tinyint(1) NOT NULL DEFAULT 1,
				auto tinyint(1) NOT NULL DEFAULT 0,
				hits bigint(20) unsigned NOT NULL DEFAULT 0,
				last_hit bigint(20) unsigned NOT NULL DEFAULT 0,
				created bigint(20) unsigned NOT NULL DEFAULT 0,
				PRIMARY KEY  (id),
				KEY lookup (match_type,source_key)
			) $charset;"
		);
		dbDelta(
			'CREATE TABLE ' . self::table_404() . " (
				path_key varchar(191) NOT NULL,
				path varchar(400) NOT NULL,
				hits bigint(20) unsigned NOT NULL DEFAULT 1,
				last_seen bigint(20) unsigned NOT NULL DEFAULT 0,
				referrer varchar(400) NOT NULL DEFAULT '',
				PRIMARY KEY  (path_key),
				KEY last_seen (last_seen)
			) $charset;"
		);
		update_option( self::DB_OPTION, self::DB_VERSION, true );
	}

	/** Cheap facts read on every request: how many rules there are, and whether 404s are logged. */
	private static function state() {
		$state = get_option( self::STATE_OPTION, array() );
		$state = is_array( $state ) ? $state : array();
		$auto  = isset( $state['auto'] ) && is_array( $state['auto'] ) ? $state['auto'] : array();
		return array(
			'rules'   => isset( $state['rules'] ) ? (int) $state['rules'] : 0,
			'others'  => isset( $state['others'] ) ? (int) $state['others'] : 0,
			'log_404' => ! empty( $state['log_404'] ),
			'auto'    => array(
				'enabled'   => ! empty( $auto['enabled'] ),
				'on_delete' => isset( $auto['on_delete'] ) && in_array( $auto['on_delete'], self::DELETE_ACTIONS, true ) ? $auto['on_delete'] : 'none',
				'target'    => isset( $auto['target'] ) && is_string( $auto['target'] ) ? $auto['target'] : '',
			),
		);
	}

	/** Recount the rules after any change and keep the answer where every request can read it. */
	private static function refresh_state( $log_404 = null, $auto = null ) {
		global $wpdb;
		$state            = self::state();
		$state['rules']   = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE enabled = 1' ); // phpcs:ignore WordPress.DB
		$state['others']  = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() . " WHERE enabled = 1 AND match_type <> 'exact'" ); // phpcs:ignore WordPress.DB
		if ( null !== $log_404 ) {
			$state['log_404'] = (bool) $log_404;
		}
		if ( null !== $auto ) {
			$state['auto'] = $auto;
		}
		update_option( self::STATE_OPTION, $state, true );
		return $state;
	}

	/* ---- Front end ---- */

	public static function boot() {
		$state = self::state();
		if ( $state['rules'] > 0 ) {
			add_action( 'template_redirect', array( __CLASS__, 'handle' ), 1 );
		}
		if ( $state['log_404'] ) {
			add_action( 'template_redirect', array( __CLASS__, 'log_404' ), 99 );
		}
		if ( $state['auto']['enabled'] ) {
			add_action( 'post_updated', array( __CLASS__, 'auto_post_updated' ), 10, 3 );
			add_action( 'wp_trash_post', array( __CLASS__, 'auto_post_removed' ) );
			add_action( 'before_delete_post', array( __CLASS__, 'auto_post_removed' ) );
			add_action( 'untrashed_post', array( __CLASS__, 'auto_post_restored' ) );
			add_action( 'transition_post_status', array( __CLASS__, 'auto_post_published' ), 10, 3 );
			add_action( 'edit_terms', array( __CLASS__, 'auto_term_before' ), 10, 2 );
			add_action( 'edited_term', array( __CLASS__, 'auto_term_after' ), 10, 3 );
			add_action( 'pre_delete_term', array( __CLASS__, 'auto_term_deleting' ), 10, 2 );
			add_action( 'delete_term', array( __CLASS__, 'auto_term_deleted' ), 10, 3 );
			add_action( 'created_term', array( __CLASS__, 'auto_term_created' ), 10, 3 );
		}
	}

	/** Only pages visitors read: never the admin, REST, Ajax, cron or login. */
	private static function front_request() {
		return ! ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) || ( defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST ) );
	}

	/** The request's path with the site's own folder (for a site in a sub-folder) taken off. */
	private static function request_path() {
		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/'; // phpcs:ignore WordPress.Security
		$path = self::normalize_path( rawurldecode( (string) $uri ) );
		$base = wp_parse_url( home_url(), PHP_URL_PATH );
		$base = is_string( $base ) ? rtrim( $base, '/' ) : '';
		if ( '' !== $base && ( $path === $base || 0 === strpos( $path, $base . '/' ) ) ) {
			$path = self::normalize_path( substr( $path, strlen( $base ) ) );
		}
		return $path;
	}

	public static function handle() {
		global $wpdb;
		if ( ! self::front_request() ) {
			return;
		}
		$state = self::state();
		$path  = self::request_path();
		$rules = array();
		$exact = $wpdb->get_row( // phpcs:ignore WordPress.DB
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . " WHERE enabled = 1 AND match_type = 'exact' AND source_key = %s LIMIT 1", self::key( $path ) ),
			ARRAY_A
		);
		if ( $exact ) {
			$rules[] = $exact;
		}
		if ( ! $exact && $state['others'] > 0 ) {
			$others = $wpdb->get_results( 'SELECT * FROM ' . self::table() . " WHERE enabled = 1 AND match_type <> 'exact' ORDER BY id", ARRAY_A ); // phpcs:ignore WordPress.DB
			$rules  = is_array( $others ) ? $others : array();
		}
		foreach ( $rules as $rule ) {
			$answer = self::match_rule( $rule, $path );
			if ( ! $answer ) {
				continue;
			}
			list( $target, $code ) = $answer;
			if ( '' !== $target && '/' === $target[0] ) {
				$target = home_url( $target );
			}
			// A rule that sends a page to itself would loop.
			if ( '' !== $target && self::key( $target ) === self::key( $path ) && wp_parse_url( $target, PHP_URL_HOST ) === wp_parse_url( home_url(), PHP_URL_HOST ) ) {
				continue;
			}
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::table() . ' SET hits = hits + 1, last_hit = %d WHERE id = %d', time(), (int) $rule['id'] ) ); // phpcs:ignore WordPress.DB
			if ( 410 === $code || 451 === $code ) {
				status_header( $code );
				nocache_headers();
				header( 'Content-Type: text/plain; charset=utf-8' );
				echo 410 === $code ? 'This page has been removed.' : 'This page is unavailable for legal reasons.';
				exit;
			}
			// A query string on the old address goes to the new one.
			$query = isset( $_SERVER['QUERY_STRING'] ) ? (string) wp_unslash( $_SERVER['QUERY_STRING'] ) : ''; // phpcs:ignore WordPress.Security
			if ( '' !== $query && false === strpos( $target, '?' ) ) {
				$target .= '?' . $query;
			}
			wp_redirect( $target, $code, 'KontrolWP' ); // phpcs:ignore WordPress.Security.SafeRedirect
			exit;
		}
	}

	/** Remember an address that 404s, keeping only the most recent few hundred. */
	public static function log_404() {
		global $wpdb;
		if ( ! is_404() || ! self::front_request() ) {
			return;
		}
		$path = self::request_path();
		// Files and well-known probes are not pages anyone wants a redirect for.
		if ( preg_match( '/\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|woff2?|ttf|txt|xml)$/i', $path ) ) {
			return;
		}
		$referrer = isset( $_SERVER['HTTP_REFERER'] ) ? substr( esc_url_raw( wp_unslash( $_SERVER['HTTP_REFERER'] ) ), 0, 400 ) : ''; // phpcs:ignore WordPress.Security
		$wpdb->query( // phpcs:ignore WordPress.DB
			$wpdb->prepare(
				'INSERT INTO ' . self::table_404() . ' (path_key, path, hits, last_seen, referrer) VALUES (%s, %s, 1, %d, %s) ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = VALUES(last_seen), referrer = IF(VALUES(referrer) <> \'\', VALUES(referrer), referrer)',
				substr( self::key( $path ), 0, 191 ),
				substr( $path, 0, 400 ),
				time(),
				$referrer
			)
		);
		if ( 0 === wp_rand( 0, 49 ) ) {
			$wpdb->query( // phpcs:ignore WordPress.DB
				$wpdb->prepare(
					'DELETE FROM ' . self::table_404() . ' WHERE path_key NOT IN (SELECT path_key FROM (SELECT path_key FROM ' . self::table_404() . ' ORDER BY last_seen DESC LIMIT %d) keep)',
					self::MAX_404
				)
			);
		}
	}

	/* ---- Automatic redirects (0.18.0) ---- */

	/** An address as stored in a rule: a path on this site, or the full address when it is on another host. */
	private static function stored_address( $url ) {
		$path = self::relative_path( $url, home_url() );
		return '' !== $path ? $path : esc_url_raw( $url );
	}

	/** Add or update an automatic rule. A rule someone made by hand for the same address is left alone. */
	private static function upsert_auto( $source, $type, $target, $code ) {
		global $wpdb;
		$key      = self::key( $source );
		$existing = $wpdb->get_row( $wpdb->prepare( 'SELECT id, auto FROM ' . self::table() . ' WHERE match_type = %s AND source_key = %s LIMIT 1', $type, $key ), ARRAY_A ); // phpcs:ignore WordPress.DB
		if ( $existing ) {
			if ( ! empty( $existing['auto'] ) ) {
				$wpdb->update( self::table(), array( 'target' => $target, 'status_code' => $code, 'enabled' => 1 ), array( 'id' => (int) $existing['id'] ) ); // phpcs:ignore WordPress.DB
				return true;
			}
			return false;
		}
		if ( (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() ) >= self::MAX_RULES ) { // phpcs:ignore WordPress.DB
			return false;
		}
		return false !== self::insert(
			array(
				'source'      => $source,
				'match_type'  => $type,
				'target'      => $target,
				'status_code' => $code,
				'enabled'     => true,
				'auto'        => true,
			)
		);
	}

	/** Forget automatic rules that start at an address now serving real content, so they cannot hide it or loop. */
	private static function drop_auto_at( $path ) {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::table() . " WHERE auto = 1 AND match_type IN ('exact', 'prefix') AND source_key = %s", self::key( $path ) ) ); // phpcs:ignore WordPress.DB
	}

	/** An address changed: send the old one to the new one, and point earlier automatic rules at the new one too. */
	private static function add_moved( $old_url, $new_url ) {
		global $wpdb;
		self::install();
		$source = self::relative_path( $old_url, home_url() );
		$target = self::stored_address( $new_url );
		if ( '' === $source || '/' === $source || self::key( $source ) === self::key( $target ) ) {
			return '';
		}
		self::drop_auto_at( self::relative_path( $new_url, home_url() ) );
		// Chains collapse: whatever automatically pointed at the old address now points at the new one.
		$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::table() . " SET target = %s WHERE auto = 1 AND match_type = 'exact' AND status_code = 301 AND target = %s", $target, $source ) ); // phpcs:ignore WordPress.DB
		self::upsert_auto( $source, 'exact', $target, 301 );
		self::refresh_state();
		return $source;
	}

	/** An address stopped serving content. Returns the path a rule was made for, or an empty string. */
	private static function add_removed( $url ) {
		global $wpdb;
		$state  = self::state();
		$action = $state['auto']['on_delete'];
		$source = self::relative_path( $url, home_url() );
		if ( 'none' === $action || '' === $source || '/' === $source ) {
			return '';
		}
		self::install();
		if ( '410' === $action ) {
			$made = self::upsert_auto( $source, 'exact', '', 410 );
		} else {
			$target = $state['auto']['target'];
			$own    = '/' === substr( $target, 0, 1 ) ? $target : self::relative_path( $target, home_url() );
			if ( '' === $target || self::key( $own ) === self::key( $source ) ) {
				return '';
			}
			// Automatic rules that led here lead to the fallback now.
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::table() . " SET target = %s WHERE auto = 1 AND match_type = 'exact' AND status_code = 301 AND target = %s", $target, $source ) ); // phpcs:ignore WordPress.DB
			$made = self::upsert_auto( $source, 'exact', $target, 301 );
		}
		self::refresh_state();
		return $made ? $source : '';
	}

	private static function viewable( $post ) {
		return $post instanceof WP_Post && 'attachment' !== $post->post_type && is_post_type_viewable( $post->post_type );
	}

	/** A published page or post whose address changed. */
	public static function auto_post_updated( $post_id, $after, $before ) {
		if ( ! self::viewable( $after ) || 'publish' !== $before->post_status || 'publish' !== $after->post_status || wp_is_post_revision( $post_id ) ) {
			return;
		}
		$old = get_permalink( $before );
		$new = get_permalink( $after );
		if ( ! $old || ! $new || $old === $new ) {
			return;
		}
		$source = self::add_moved( $old, $new );
		// Pages below this one moved with it, without being saved themselves.
		if ( '' !== $source && is_post_type_hierarchical( $after->post_type ) ) {
			$children = get_children(
				array(
					'post_parent' => $post_id,
					'post_type'   => $after->post_type,
					'post_status' => 'publish',
					'numberposts' => 1,
					'fields'      => 'ids',
				)
			);
			if ( $children ) {
				self::upsert_auto( $source, 'prefix', rtrim( self::stored_address( $new ), '/' ) . '/$1', 301 );
			}
		}
	}

	/** Published content is being trashed or deleted. Content already in the trash was handled when it went there. */
	public static function auto_post_removed( $post_id ) {
		$post = get_post( $post_id );
		if ( ! self::viewable( $post ) || 'publish' !== $post->post_status ) {
			return;
		}
		$source = self::add_removed( get_permalink( $post ) );
		if ( '' !== $source ) {
			update_post_meta( $post_id, self::META_AUTO_SOURCE, $source );
		}
	}

	/** Content came back from the trash: the rule made when it left is no longer wanted. */
	public static function auto_post_restored( $post_id ) {
		$source = (string) get_post_meta( $post_id, self::META_AUTO_SOURCE, true );
		if ( '' === $source ) {
			return;
		}
		self::drop_auto_at( $source );
		delete_post_meta( $post_id, self::META_AUTO_SOURCE );
		self::refresh_state();
	}

	/** Content published at an address that an automatic rule points away from: the rule goes. */
	public static function auto_post_published( $new_status, $old_status, $post ) {
		if ( 'publish' !== $new_status || 'publish' === $old_status || ! self::viewable( $post ) ) {
			return;
		}
		$path = self::relative_path( get_permalink( $post ), home_url() );
		if ( '' !== $path ) {
			self::drop_auto_at( $path );
			self::refresh_state();
		}
	}

	private static $term_links = array();

	public static function auto_term_before( $term_id, $taxonomy ) {
		if ( ! is_taxonomy_viewable( $taxonomy ) ) {
			return;
		}
		$link = get_term_link( (int) $term_id, $taxonomy );
		if ( ! is_wp_error( $link ) ) {
			self::$term_links[ (int) $term_id ] = $link;
		}
	}

	/** A category, tag or other term whose address changed. Terms below it are covered by a prefix rule. */
	public static function auto_term_after( $term_id, $tt_id, $taxonomy ) {
		$term_id = (int) $term_id;
		if ( ! isset( self::$term_links[ $term_id ] ) ) {
			return;
		}
		$old = self::$term_links[ $term_id ];
		unset( self::$term_links[ $term_id ] );
		$new = get_term_link( $term_id, $taxonomy );
		if ( is_wp_error( $new ) || $new === $old ) {
			return;
		}
		$source = self::add_moved( $old, $new );
		if ( '' !== $source && is_taxonomy_hierarchical( $taxonomy ) && get_term_children( $term_id, $taxonomy ) ) {
			self::upsert_auto( $source, 'prefix', rtrim( self::stored_address( $new ), '/' ) . '/$1', 301 );
		}
	}

	/** Term addresses recorded before a delete: the term's own, and those of the terms directly below it, which move up a level. */
	private static $deleting = array();

	public static function auto_term_deleting( $term_id, $taxonomy ) {
		if ( ! is_taxonomy_viewable( $taxonomy ) ) {
			return;
		}
		$link = get_term_link( (int) $term_id, $taxonomy );
		if ( is_wp_error( $link ) ) {
			return;
		}
		$children = array();
		if ( is_taxonomy_hierarchical( $taxonomy ) ) {
			$ids = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'parent'     => (int) $term_id,
					'hide_empty' => false,
					'fields'     => 'ids',
					'number'     => 50,
				)
			);
			foreach ( is_array( $ids ) ? $ids : array() as $child ) {
				$child_link = get_term_link( (int) $child, $taxonomy );
				if ( ! is_wp_error( $child_link ) ) {
					$children[ (int) $child ] = $child_link;
				}
			}
		}
		self::$deleting[ (int) $term_id ] = array(
			'link'     => $link,
			'children' => $children,
		);
	}

	/** A term was deleted: its address follows the delete setting, and the terms that moved up keep their old addresses working. */
	public static function auto_term_deleted( $term_id, $tt_id, $taxonomy ) {
		$term_id = (int) $term_id;
		if ( ! isset( self::$deleting[ $term_id ] ) ) {
			return;
		}
		$was = self::$deleting[ $term_id ];
		unset( self::$deleting[ $term_id ] );
		foreach ( $was['children'] as $child => $old ) {
			$new = get_term_link( $child, $taxonomy );
			if ( ! is_wp_error( $new ) && $new !== $old ) {
				self::add_moved( $old, $new );
			}
		}
		self::add_removed( $was['link'] );
	}

	/** A term created at an address that an automatic rule points away from: the rule goes. */
	public static function auto_term_created( $term_id, $tt_id, $taxonomy ) {
		if ( ! is_taxonomy_viewable( $taxonomy ) ) {
			return;
		}
		$link = get_term_link( (int) $term_id, $taxonomy );
		if ( ! is_wp_error( $link ) ) {
			self::drop_auto_at( self::relative_path( $link, home_url() ) );
			self::refresh_state();
		}
	}

	/* ---- Dashboard routes ---- */

	private static function row_out( $row ) {
		return array(
			'id'          => (int) $row['id'],
			'source'      => $row['source'],
			'match_type'  => $row['match_type'],
			'target'      => $row['target'],
			'status_code' => (int) $row['status_code'],
			'enabled'     => (bool) $row['enabled'],
			'auto'        => ! empty( $row['auto'] ),
			'hits'        => (int) $row['hits'],
			'last_hit'    => (int) $row['last_hit'],
		);
	}

	/** Rules, newest first, filtered by a search; or every rule when `export` is set. */
	public static function index( $request ) {
		global $wpdb;
		self::install();
		$search = trim( (string) $request->get_param( 'search' ) );
		$where  = $request->get_param( 'auto' ) ? 'auto = 1' : '1=1';
		$args   = array();
		if ( '' !== $search ) {
			$like   = '%' . $wpdb->esc_like( $search ) . '%';
			$where .= ' AND (source LIKE %s OR target LIKE %s)';
			$args[] = $like;
			$args[] = $like;
		}
		$count_sql = 'SELECT COUNT(*) FROM ' . self::table() . ' WHERE ' . $where;
		$total     = (int) ( $args ? $wpdb->get_var( $wpdb->prepare( $count_sql, $args ) ) : $wpdb->get_var( $count_sql ) ); // phpcs:ignore WordPress.DB
		$export    = (bool) $request->get_param( 'export' );
		$per_page  = $export ? self::MAX_RULES : min( self::MAX_PER_PAGE, max( 1, (int) ( $request->get_param( 'per_page' ) ? $request->get_param( 'per_page' ) : 25 ) ) );
		$page      = max( 1, (int) $request->get_param( 'page' ) );
		$sql       = 'SELECT * FROM ' . self::table() . ' WHERE ' . $where . ' ORDER BY id DESC LIMIT %d OFFSET %d';
		$rows      = $wpdb->get_results( $wpdb->prepare( $sql, array_merge( $args, array( $per_page, $export ? 0 : ( $page - 1 ) * $per_page ) ) ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$state     = self::state();
		return array(
			'items'   => array_map( array( __CLASS__, 'row_out' ), is_array( $rows ) ? $rows : array() ),
			'total'   => $total,
			'log_404' => $state['log_404'],
			'auto'    => $state['auto'],
		);
	}

	/** Insert one cleaned rule; false when the same source and match type already exist. */
	private static function insert( $rule ) {
		global $wpdb;
		$key    = 'regex' === $rule['match_type'] ? substr( $rule['source'], 0, 191 ) : self::key( $rule['source'] );
		$exists = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::table() . ' WHERE match_type = %s AND source_key = %s LIMIT 1', $rule['match_type'], $key ) ); // phpcs:ignore WordPress.DB
		if ( $exists ) {
			return false;
		}
		$wpdb->insert( // phpcs:ignore WordPress.DB
			self::table(),
			array(
				'source'      => $rule['source'],
				'source_key'  => $key,
				'match_type'  => $rule['match_type'],
				'target'      => $rule['target'],
				'status_code' => $rule['status_code'],
				'enabled'     => $rule['enabled'] ? 1 : 0,
				'auto'        => ! empty( $rule['auto'] ) ? 1 : 0,
				'created'     => time(),
			)
		);
		return (int) $wpdb->insert_id;
	}

	/** Create a rule, or change the one with `id`. */
	public static function save( $request ) {
		global $wpdb;
		self::install();
		list( $rule, $error ) = self::clean_rule( (array) $request->get_json_params() );
		if ( ! $rule ) {
			return new WP_Error( 'kontrolwp_invalid_redirect', $error, array( 'status' => 400 ) );
		}
		$id = (int) $request->get_param( 'id' );
		if ( $id > 0 ) {
			$key   = 'regex' === $rule['match_type'] ? substr( $rule['source'], 0, 191 ) : self::key( $rule['source'] );
			$clash = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . self::table() . ' WHERE match_type = %s AND source_key = %s AND id <> %d LIMIT 1', $rule['match_type'], $key, $id ) ); // phpcs:ignore WordPress.DB
			if ( $clash ) {
				return new WP_Error( 'kontrolwp_duplicate_redirect', 'A redirect from that address already exists.', array( 'status' => 409 ) );
			}
			$wpdb->update( // phpcs:ignore WordPress.DB
				self::table(),
				array(
					'source'      => $rule['source'],
					'source_key'  => $key,
					'match_type'  => $rule['match_type'],
					'target'      => $rule['target'],
					'status_code' => $rule['status_code'],
					'enabled'     => $rule['enabled'] ? 1 : 0,
				),
				array( 'id' => $id )
			);
		} else {
			if ( (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() ) >= self::MAX_RULES ) { // phpcs:ignore WordPress.DB
				return new WP_Error( 'kontrolwp_too_many_redirects', 'This site has reached the limit of ' . self::MAX_RULES . ' redirects.', array( 'status' => 400 ) );
			}
			if ( false === self::insert( $rule ) ) {
				return new WP_Error( 'kontrolwp_duplicate_redirect', 'A redirect from that address already exists.', array( 'status' => 409 ) );
			}
		}
		self::refresh_state();
		return array( 'ok' => true );
	}

	/** Enable, disable or delete several rules at once. */
	public static function bulk( $request ) {
		global $wpdb;
		self::install();
		$ids    = array_values( array_filter( array_map( 'intval', (array) $request->get_param( 'ids' ) ) ) );
		$action = (string) $request->get_param( 'action' );
		if ( ! $ids || ! in_array( $action, array( 'enable', 'disable', 'delete' ), true ) ) {
			return new WP_Error( 'kontrolwp_invalid_redirect', 'Choose redirects and an action.', array( 'status' => 400 ) );
		}
		$ids          = array_slice( $ids, 0, self::MAX_RULES );
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		if ( 'delete' === $action ) {
			$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::table() . " WHERE id IN ($placeholders)", $ids ) ); // phpcs:ignore WordPress.DB
		} else {
			$wpdb->query( $wpdb->prepare( 'UPDATE ' . self::table() . " SET enabled = %d WHERE id IN ($placeholders)", array_merge( array( 'enable' === $action ? 1 : 0 ), $ids ) ) ); // phpcs:ignore WordPress.DB
		}
		self::refresh_state();
		return array( 'ok' => true );
	}

	/** Add many rules from a file. Rules that already exist are skipped; bad rows are reported by row number. */
	public static function import( $request ) {
		self::install();
		return self::import_rules( (array) $request->get_param( 'rows' ) );
	}

	/** Add rules from rows of untrusted input. Returns array( added, skipped, errors ). */
	public static function import_rules( $rows ) {
		global $wpdb;
		self::install();
		$count   = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table() ); // phpcs:ignore WordPress.DB
		$added   = 0;
		$skipped = 0;
		$errors  = array();
		foreach ( array_slice( array_values( $rows ), 0, self::MAX_RULES ) as $index => $row ) {
			list( $rule, $error ) = self::clean_rule( is_array( $row ) ? $row : array() );
			if ( ! $rule ) {
				$errors[] = array(
					'row'     => $index + 1,
					'message' => $error,
				);
				continue;
			}
			if ( $count + $added >= self::MAX_RULES ) {
				$errors[] = array(
					'row'     => $index + 1,
					'message' => 'The limit of ' . self::MAX_RULES . ' redirects was reached.',
				);
				break;
			}
			if ( false === self::insert( $rule ) ) {
				++$skipped;
			} else {
				++$added;
			}
		}
		self::refresh_state();
		return array(
			'added'   => $added,
			'skipped' => $skipped,
			'errors'  => array_slice( $errors, 0, 50 ),
		);
	}

	/** Turn the 404 log and the automatic redirects on or off; only what is sent changes. */
	public static function save_settings( $request ) {
		self::install();
		$state = self::state();
		$auto  = $state['auto'];
		$log   = null !== $request->get_param( 'log_404' ) ? (bool) $request->get_param( 'log_404' ) : null;
		if ( null !== $request->get_param( 'auto_enabled' ) ) {
			$auto['enabled'] = (bool) $request->get_param( 'auto_enabled' );
		}
		if ( null !== $request->get_param( 'on_delete' ) ) {
			$action = (string) $request->get_param( 'on_delete' );
			if ( ! in_array( $action, self::DELETE_ACTIONS, true ) ) {
				return new WP_Error( 'kontrolwp_invalid_redirect', 'Choose what happens when content is removed.', array( 'status' => 400 ) );
			}
			$auto['on_delete'] = $action;
		}
		if ( null !== $request->get_param( 'delete_target' ) ) {
			$target = trim( (string) $request->get_param( 'delete_target' ) );
			if ( '' !== $target && ( ! self::target_ok( $target ) ) ) {
				return new WP_Error( 'kontrolwp_invalid_redirect', 'The address must start with http:// or https://, or be a path starting with /.', array( 'status' => 400 ) );
			}
			$auto['target'] = $target;
		}
		if ( '301' === $auto['on_delete'] && '' === $auto['target'] ) {
			return new WP_Error( 'kontrolwp_invalid_redirect', 'Enter the address to send removed pages to.', array( 'status' => 400 ) );
		}
		$state = self::refresh_state( $log, $auto );
		return array(
			'log_404' => $state['log_404'],
			'auto'    => $state['auto'],
		);
	}

	public static function not_found_index( $request ) {
		global $wpdb;
		self::install();
		$page  = max( 1, (int) $request->get_param( 'page' ) );
		$rows  = $wpdb->get_results( $wpdb->prepare( 'SELECT path, hits, last_seen, referrer FROM ' . self::table_404() . ' ORDER BY hits DESC, last_seen DESC LIMIT %d OFFSET %d', 25, ( $page - 1 ) * 25 ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$total = (int) $wpdb->get_var( 'SELECT COUNT(*) FROM ' . self::table_404() ); // phpcs:ignore WordPress.DB
		$items = array();
		foreach ( is_array( $rows ) ? $rows : array() as $row ) {
			$items[] = array(
				'path'      => $row['path'],
				'hits'      => (int) $row['hits'],
				'last_seen' => (int) $row['last_seen'],
				'referrer'  => $row['referrer'],
			);
		}
		return array(
			'items' => $items,
			'total' => $total,
		);
	}

	public static function not_found_clear() {
		global $wpdb;
		self::install();
		$wpdb->query( 'DELETE FROM ' . self::table_404() ); // phpcs:ignore WordPress.DB
		return array( 'ok' => true );
	}
}
