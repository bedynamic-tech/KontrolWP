<?php
/**
 * Two opt-in changes to WordPress's own archive addresses: leaving "category"
 * out of category URLs, and switching author archives off. Both are off until
 * the owner turns them on, and neither changes anything while SEO is off or
 * another SEO plugin is active.
 *
 * @package KontrolWP_Connect
 */

defined( 'ABSPATH' ) || exit;

class KontrolWP_Connect_SEO_Archives {

	/** Addresses WordPress already uses at the top level, which a category must never take over. */
	const RESERVED = array( 'wp-admin', 'wp-content', 'wp-includes', 'wp-json', 'wp-login', 'wp-sitemap', 'feed', 'comments', 'embed', 'page', 'author', 'search', 'tag', 'category', 'attachment', 'trackback', 'robots', 'sitemap', 'llms' );

	/** More categories than this and the extra ones keep their old address, so the rewrite rules stay small. */
	const MAX_CATEGORIES = 500;

	/* ---- Pure helpers (tested outside WordPress) ---- */

	/**
	 * A category address without its base. Only an address that starts with the
	 * home address and the base is changed, so a link with some other prefix is
	 * left alone rather than guessed at.
	 */
	public static function strip_category_base( $url, $home, $base ) {
		$base   = trim( (string) $base, '/' );
		$prefix = rtrim( (string) $home, '/' ) . '/' . $base . '/';
		if ( '' === $base || 0 !== strpos( $url, $prefix ) ) {
			return $url;
		}
		return rtrim( (string) $home, '/' ) . '/' . substr( $url, strlen( $prefix ) );
	}

	/** The same change for a request path (with any query), where the home address has a folder: "/blog" and "/blog/category/news/". */
	public static function strip_category_base_path( $uri, $home_path, $base ) {
		$base   = trim( (string) $base, '/' );
		$prefix = rtrim( (string) $home_path, '/' ) . '/' . $base . '/';
		if ( '' === $base || 0 !== strpos( $uri, $prefix ) ) {
			return $uri;
		}
		return rtrim( (string) $home_path, '/' ) . '/' . substr( $uri, strlen( $prefix ) );
	}

	/**
	 * Which of the categories can lose the base. $categories is a list of
	 * { id, path } where path is the slug path ("news" or "news/local"); $taken
	 * is the list of top-level addresses pages and posts already use. A category
	 * whose path is reserved or taken stays as it is, so it never hides a page.
	 * Returns { eligible: id => path, skipped: [path, ...] }.
	 */
	public static function eligible_categories( $categories, $taken, $max = self::MAX_CATEGORIES ) {
		$taken    = array_flip( array_map( 'strval', $taken ) );
		$eligible = array();
		$skipped  = array();
		foreach ( $categories as $item ) {
			$path = (string) $item['path'];
			$top  = false === strpos( $path, '/' ) ? $path : '';
			if ( '' === $path || count( $eligible ) >= $max || in_array( strtok( $path, '/' ), self::RESERVED, true ) || ( '' !== $top && isset( $taken[ $top ] ) ) ) {
				$skipped[] = $path;
				continue;
			}
			$eligible[ (int) $item['id'] ] = $path;
		}
		return array(
			'eligible' => $eligible,
			'skipped'  => $skipped,
		);
	}

	/** Rewrite rules that send each category's short address to the category page, with its feed and page two onward. */
	public static function category_rules( $paths ) {
		$feeds = 'feed|rdf|rss|rss2|atom';
		$rules = array();
		foreach ( $paths as $path ) {
			$q                                                = preg_quote( $path, '/' );
			$rules[ '^' . $q . '/feed/(' . $feeds . ')/?$' ] = 'index.php?category_name=' . $path . '&feed=$matches[1]';
			$rules[ '^' . $q . '/(' . $feeds . ')/?$' ]      = 'index.php?category_name=' . $path . '&feed=$matches[1]';
			$rules[ '^' . $q . '/page/?([0-9]{1,})/?$' ]     = 'index.php?category_name=' . $path . '&paged=$matches[1]';
			$rules[ '^' . $q . '/?$' ]                       = 'index.php?category_name=' . $path;
		}
		return $rules;
	}

	/* ---- WordPress glue ---- */

	private static $state = null;
	private static $bypass = false;

	public static function boot() {
		$settings = KontrolWP_Connect_SEO::settings();
		if ( empty( $settings['enabled'] ) || '' !== KontrolWP_Connect_SEO::conflict() ) {
			return;
		}
		if ( 'keep' !== $settings['author_archives'] ) {
			add_action( 'template_redirect', array( __CLASS__, 'handle_author' ), 0 );
		}
		if ( $settings['strip_category_base'] && self::supported() ) {
			add_filter( 'term_link', array( __CLASS__, 'filter_term_link' ), 10, 3 );
			add_filter( 'category_rewrite_rules', array( __CLASS__, 'filter_rules' ) );
			add_action( 'template_redirect', array( __CLASS__, 'redirect_old_category' ), 0 );
			foreach ( array( 'created_category', 'edited_category', 'delete_category' ) as $hook ) {
				add_action( $hook, array( __CLASS__, 'flush' ) );
			}
		}
	}

	/** Forget the stored rewrite rules; WordPress builds them again on the next request. */
	public static function flush() {
		delete_option( 'rewrite_rules' );
		self::$state = null;
	}

	/** Short category addresses need pretty permalinks. */
	private static function supported() {
		return '' !== (string) get_option( 'permalink_structure', '' );
	}

	public static function base() {
		$base = trim( (string) get_option( 'category_base', '' ), '/' );
		return '' !== $base ? $base : 'category';
	}

	/** Which categories lose the base, computed once per request. */
	private static function state() {
		if ( null !== self::$state ) {
			return self::$state;
		}
		global $wpdb;
		$terms      = get_terms(
			array(
				'taxonomy'   => 'category',
				'hide_empty' => false,
				'number'     => self::MAX_CATEGORIES + 100,
				'orderby'    => 'id',
			)
		);
		$categories = array();
		if ( is_array( $terms ) ) {
			foreach ( $terms as $term ) {
				$parents = get_category_parents( $term->term_id, false, '/', true );
				$path    = is_string( $parents ) ? trim( $parents, '/' ) : $term->slug;
				$categories[] = array(
					'id'   => (int) $term->term_id,
					'path' => $path,
				);
			}
		}
		$slugs = array();
		foreach ( $categories as $item ) {
			if ( false === strpos( $item['path'], '/' ) ) {
				$slugs[] = $item['path'];
			}
		}
		$taken = array();
		if ( $slugs ) {
			$marks = implode( ',', array_fill( 0, count( $slugs ), '%s' ) );
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery
			$taken = $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT post_name FROM {$wpdb->posts} WHERE post_status = 'publish' AND post_type IN ('page','post') AND post_name IN ($marks)", $slugs ) );
		}
		self::$state = self::eligible_categories( $categories, is_array( $taken ) ? $taken : array() );
		return self::$state;
	}

	public static function filter_term_link( $link, $term, $taxonomy ) {
		if ( 'category' !== $taxonomy || self::$bypass ) {
			return $link;
		}
		$state = self::state();
		if ( ! isset( $state['eligible'][ (int) $term->term_id ] ) ) {
			return $link;
		}
		return self::strip_category_base( $link, home_url(), self::base() );
	}

	public static function filter_rules( $rules ) {
		$state = self::state();
		return array_merge( self::category_rules( array_values( $state['eligible'] ) ), $rules );
	}

	/** The old address of a category answers with a permanent redirect to the short one. */
	public static function redirect_old_category() {
		if ( ! is_category() || empty( $_SERVER['REQUEST_URI'] ) ) {
			return;
		}
		$term  = get_queried_object();
		$state = self::state();
		if ( ! $term || ! isset( $term->term_id ) || ! isset( $state['eligible'][ (int) $term->term_id ] ) ) {
			return;
		}
		$uri  = wp_unslash( $_SERVER['REQUEST_URI'] ); // phpcs:ignore WordPress.Security
		$path = self::strip_category_base_path( $uri, (string) wp_parse_url( home_url(), PHP_URL_PATH ), self::base() );
		if ( $path === $uri ) {
			return;
		}
		$origin = preg_replace( '#^(https?://[^/]+).*$#', '$1', home_url() );
		wp_safe_redirect( $origin . $path, 301 );
		exit;
	}

	/** Author archives go to the home page or answer "not found". */
	public static function handle_author() {
		if ( ! is_author() ) {
			return;
		}
		$settings = KontrolWP_Connect_SEO::settings();
		if ( 'redirect' === $settings['author_archives'] ) {
			wp_safe_redirect( home_url( '/' ), 301 );
			exit;
		}
		global $wp_query;
		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
	}

	/** What the dashboard shows beside the category setting: a real address before and after. */
	public static function category_report() {
		$base = self::base();
		if ( ! self::supported() ) {
			return array(
				'supported' => false,
				'base'      => $base,
				'old'       => '',
				'new'       => '',
				'skipped'   => array(),
			);
		}
		self::$state  = null;
		$state        = self::state();
		$sample       = get_terms(
			array(
				'taxonomy'   => 'category',
				'hide_empty' => false,
				'number'     => 1,
				'orderby'    => 'count',
				'order'      => 'DESC',
				'include'    => $state['eligible'] ? array_keys( $state['eligible'] ) : array( 0 ),
			)
		);
		$old = '';
		$new = '';
		if ( is_array( $sample ) && $sample ) {
			self::$bypass = true;
			$link         = get_term_link( $sample[0] );
			self::$bypass = false;
			$old          = is_string( $link ) ? $link : '';
			$new          = self::strip_category_base( $old, home_url(), $base );
		}
		return array(
			'supported' => $new !== '' && $new !== $old,
			'base'      => $base,
			'old'       => $old,
			'new'       => $new,
			'skipped'   => array_slice( $state['skipped'], 0, 20 ),
		);
	}
}
