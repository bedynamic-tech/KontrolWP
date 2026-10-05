<?php
/**
 * Moves SEO settings, per-page meta and redirections from another SEO plugin
 * into KontrolWP Connect, and can then deactivate that plugin.
 *
 * Nothing here deletes the other plugin or anything it stored. Importing only
 * adds: page meta is written only where KontrolWP has none, settings only
 * where KontrolWP is still at its default, and redirects that already exist
 * are skipped, so running it again changes nothing.
 *
 * The storage formats are those the other plugins document or are known to
 * use. Where a plugin keeps something this code does not recognise, it is
 * left out rather than guessed, and the preview shows what will be imported.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Migrate {

	const MAX_META_ROWS = 60000;

	/** The plugins that can be imported from. Add-ons are listed first so they are deactivated before the plugin they extend. */
	const SOURCES = array(
		'yoast'    => array(
			'name'  => 'Yoast SEO',
			'files' => array( 'wordpress-seo-premium/wp-seo-premium.php', 'wordpress-seo/wp-seo.php' ),
		),
		'rankmath' => array(
			'name'  => 'Rank Math',
			'files' => array( 'seo-by-rank-math-pro/rank-math-pro.php', 'seo-by-rank-math/rank-math.php' ),
		),
		'aioseo'   => array(
			'name'  => 'All in One SEO',
			'files' => array( 'all-in-one-seo-pack-pro/all_in_one_seo_pack.php', 'all-in-one-seo-pack/all_in_one_seo_pack.php' ),
		),
		'seopress' => array(
			'name'  => 'SEOPress',
			'files' => array( 'wp-seopress-pro/seopress-pro.php', 'wp-seopress/seopress.php' ),
		),
		'slimseo'  => array(
			'name'  => 'Slim SEO',
			'files' => array( 'slim-seo/slim-seo.php' ),
		),
	);

	/** How each plugin writes the parts of a title, and what they are in KontrolWP. */
	const TOKENS = array(
		'yoast'    => array(
			'pattern' => '/%%(\w+)%%/',
			'names'   => array(
				'title'     => '%title%',
				'sitename'  => '%sitename%',
				'sitedesc'  => '%tagline%',
				'sep'       => '%sep%',
			),
		),
		'rankmath' => array(
			'pattern' => '/%(\w+)%/',
			'names'   => array(
				'title'      => '%title%',
				'page_title' => '%title%',
				'sitename'   => '%sitename%',
				'sitedesc'   => '%tagline%',
				'sep'        => '%sep%',
			),
		),
		'aioseo'   => array(
			'pattern' => '/#(\w+)/',
			'names'   => array(
				'post_title'    => '%title%',
				'page_title'    => '%title%',
				'site_title'    => '%sitename%',
				'tagline'       => '%tagline%',
				'separator_sa'  => '%sep%',
			),
		),
		'seopress' => array(
			'pattern' => '/%%(\w+)%%/',
			'names'   => array(
				'post_title' => '%title%',
				'sitetitle'  => '%sitename%',
				'tagline'    => '%tagline%',
				'sep'        => '%sep%',
			),
		),
		'slimseo'  => array(
			'pattern' => '/\{\{\s*(\w+)\s*\}\}/',
			'names'   => array(
				'post_title' => '%title%',
				'site_title' => '%sitename%',
				'tagline'    => '%tagline%',
			),
		),
	);

	/** Where Yoast keeps its separator choice. */
	const YOAST_SEPARATORS = array(
		'sc-dash'   => '-',
		'sc-ndash'  => '-',
		'sc-mdash'  => '-',
		'sc-pipe'   => '|',
		'sc-middot' => '·',
		'sc-raquo'  => '»',
		'sc-bull'   => '•',
	);

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/seo/migrate'            => 'sources',
			'/seo/migrate/preview'    => 'preview',
			'/seo/migrate/run'        => 'run',
			'/seo/migrate/deactivate' => 'deactivate',
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

	/** A title or description template from another plugin, in KontrolWP's tokens. Tokens KontrolWP has no equivalent for are dropped. */
	public static function convert_tokens( $template, $source ) {
		if ( ! isset( self::TOKENS[ $source ] ) || ! is_string( $template ) ) {
			return '';
		}
		$names = self::TOKENS[ $source ]['names'];
		$out   = preg_replace_callback(
			self::TOKENS[ $source ]['pattern'],
			function ( $m ) use ( $names ) {
				return isset( $names[ $m[1] ] ) ? $names[ $m[1] ] : '';
			},
			$template
		);
		return trim( preg_replace( '/\s+/u', ' ', $out ) );
	}

	/** One of KontrolWP's title separators for another plugin's setting, or an empty string when there is no match. */
	public static function map_separator( $value ) {
		if ( ! is_string( $value ) ) {
			return '';
		}
		if ( isset( self::YOAST_SEPARATORS[ $value ] ) ) {
			return self::YOAST_SEPARATORS[ $value ];
		}
		$value = trim( $value );
		if ( in_array( $value, KontrolWP_Connect_SEO::SEPARATORS, true ) ) {
			return $value;
		}
		return in_array( $value, array( '–', '—', '&ndash;', '&mdash;' ), true ) ? '-' : '';
	}

	/** Whether a value another plugin stores for "hide from search" means yes. */
	public static function is_noindex( $value ) {
		if ( is_array( $value ) ) {
			return in_array( 'noindex', $value, true );
		}
		return in_array( (string) $value, array( '1', 'yes', 'true', 'noindex' ), true );
	}

	/**
	 * Rank Math's redirection rows as KontrolWP rules. A row can hold several
	 * sources, and each becomes a rule. "Contains" and "ends with" become
	 * regular expressions; Rank Math's own regular expressions are matched
	 * against a path without its leading slash, so one that starts with ^ is
	 * given an optional slash.
	 */
	public static function rankmath_rules( $row ) {
		$sources = isset( $row['sources'] ) ? $row['sources'] : array();
		if ( is_string( $sources ) ) {
			$sources = @unserialize( $sources, array( 'allowed_classes' => false ) ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		}
		if ( ! is_array( $sources ) ) {
			return array();
		}
		$rules = array();
		foreach ( $sources as $item ) {
			if ( ! is_array( $item ) || empty( $item['pattern'] ) ) {
				continue;
			}
			$pattern = (string) $item['pattern'];
			$compare = isset( $item['comparison'] ) ? (string) $item['comparison'] : 'exact';
			$type    = 'exact';
			switch ( $compare ) {
				case 'start':
					$type = 'prefix';
					break;
				case 'contains':
					$type    = 'regex';
					$pattern = preg_quote( $pattern, '#' );
					break;
				case 'end':
					$type    = 'regex';
					$pattern = preg_quote( $pattern, '#' ) . '$';
					break;
				case 'regex':
					$type = 'regex';
					if ( 0 === strpos( $pattern, '^' ) ) {
						$pattern = '^/?' . ltrim( substr( $pattern, 1 ), '/' );
					}
					break;
			}
			$rules[] = array(
				'source'      => $pattern,
				'match_type'  => $type,
				'target'      => isset( $row['url_to'] ) ? (string) $row['url_to'] : '',
				'status_code' => isset( $row['header_code'] ) ? (int) $row['header_code'] : 301,
				'enabled'     => ! isset( $row['status'] ) || 'active' === $row['status'],
			);
		}
		return $rules;
	}

	/** One of KontrolWP's Twitter card types for another plugin's value, or an empty string. */
	public static function card_type( $value ) {
		$value = is_string( $value ) ? strtolower( trim( $value ) ) : '';
		if ( 'summary_large_image' === $value ) {
			return 'summary_large_image';
		}
		return in_array( $value, array( 'summary', 'summary_card' ), true ) ? 'summary' : '';
	}

	/** "organization" or "person" for what another plugin says the site is, or an empty string. */
	public static function schema_kind( $value ) {
		$value = is_string( $value ) ? strtolower( trim( $value ) ) : '';
		if ( in_array( $value, array( 'company', 'organization', 'organisation' ), true ) ) {
			return 'organization';
		}
		return 'person' === $value ? 'person' : '';
	}

	/** The first keyword of a comma-separated list (or a list), as a focus keyword; empty when none. */
	public static function first_keyword( $value ) {
		if ( is_string( $value ) ) {
			$value = explode( ',', $value );
		}
		foreach ( is_array( $value ) ? $value : array() as $item ) {
			$item = is_string( $item ) ? trim( $item ) : '';
			if ( '' !== $item ) {
				return $item;
			}
		}
		return '';
	}

	/** Text another plugin saved with HTML entities (such as &raquo;), as plain text. */
	public static function entity_text( $value ) {
		return is_string( $value ) ? trim( html_entity_decode( $value, ENT_QUOTES, 'UTF-8' ) ) : '';
	}

	/** A profile address for a Twitter or X handle (with or without @), or an empty string. */
	public static function handle_url( $handle ) {
		$handle = ltrim( trim( (string) $handle ), '@' );
		return preg_match( '/^[A-Za-z0-9_]{1,15}$/', $handle ) ? 'https://x.com/' . $handle : '';
	}

	/** Web addresses from a mix of values: lists, lines of text, or single addresses. Anything that is not an http(s) address is dropped. */
	public static function web_addresses( $values ) {
		$out = array();
		foreach ( (array) $values as $value ) {
			$parts = is_array( $value ) ? $value : preg_split( '/[\r\n]+/', (string) $value );
			foreach ( $parts as $part ) {
				$part = is_string( $part ) ? trim( $part ) : '';
				if ( preg_match( '#^https?://[^\s<>"\']+$#i', $part ) ) {
					$out[] = $part;
				}
			}
		}
		return array_values( array_unique( $out ) );
	}

	/** Two lists as one, keeping the order and each value once. */
	public static function merge_list( $current, $found ) {
		return array_values( array_unique( array_merge( (array) $current, (array) $found ) ) );
	}

	/** Title and description templates by content type: types KontrolWP has no template for are added, the others stay as they are. */
	public static function merge_templates( $current, $found ) {
		$out = (array) $current;
		foreach ( (array) $found as $type => $item ) {
			if ( ! isset( $out[ $type ] ) && is_array( $item ) ) {
				$out[ $type ] = $item;
			}
		}
		return $out;
	}

	/**
	 * KontrolWP's content settings after importing. Text and choices are set
	 * only where KontrolWP still has its default, switches are only ever
	 * switched on, and address lists gain what they lack. Returns
	 * array( settings, names of the settings that changed ).
	 */
	public static function merge_content( $current, $defaults, $found ) {
		$new     = $current;
		$changed = array();
		foreach ( $found as $key => $value ) {
			if ( ! array_key_exists( $key, $defaults ) ) {
				continue;
			}
			if ( is_bool( $value ) ) {
				if ( $value && ! $current[ $key ] ) {
					$new[ $key ] = true;
					$changed[]   = $key;
				}
			} elseif ( is_array( $value ) ) {
				$merged = self::merge_list( $current[ $key ], $value );
				if ( $merged !== array_values( (array) $current[ $key ] ) ) {
					$new[ $key ] = $merged;
					$changed[]   = $key;
				}
			} elseif ( $current[ $key ] === $defaults[ $key ] && $value !== $current[ $key ] ) {
				$new[ $key ] = $value;
				$changed[]   = $key;
			}
		}
		return array( $new, $changed );
	}

	/** A value from a nested array by a list of keys, or null. */
	public static function dig( $data, $path ) {
		foreach ( $path as $key ) {
			if ( ! is_array( $data ) || ! array_key_exists( $key, $data ) ) {
				return null;
			}
			$data = $data[ $key ];
		}
		return $data;
	}

	/* ---- Finding the plugins ---- */

	private static function installed_files() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		return array_keys( get_plugins() );
	}

	/** The plugin files of a source that are installed, with whether each is active. */
	private static function files_of( $source ) {
		$installed = self::installed_files();
		$out       = array();
		foreach ( self::SOURCES[ $source ]['files'] as $file ) {
			if ( in_array( $file, $installed, true ) ) {
				$out[ $file ] = is_plugin_active( $file ) || ( is_multisite() && is_plugin_active_for_network( $file ) );
			}
		}
		return $out;
	}

	private static function source_from( $request ) {
		$source = (string) $request->get_param( 'source' );
		return isset( self::SOURCES[ $source ] ) ? $source : '';
	}

	private static function unknown_source() {
		return new WP_Error( 'kontrolwp_unknown_source', 'Choose one of the detected SEO plugins.', array( 'status' => 400 ) );
	}

	/** SEO plugins installed on the site, active or not: their data is still there to import. */
	public static function sources( $request = null ) {
		$out = array();
		foreach ( self::SOURCES as $id => $info ) {
			$files = self::files_of( $id );
			if ( $files ) {
				$out[] = array(
					'id'     => $id,
					'name'   => $info['name'],
					'active' => in_array( true, $files, true ),
				);
			}
		}
		return array( 'sources' => $out );
	}

	/* ---- Reading another plugin's data ---- */

	private static function option( $name ) {
		$value = get_option( $name, array() );
		if ( is_string( $value ) ) {
			$decoded = json_decode( $value, true );
			$value   = is_array( $decoded ) ? $decoded : array();
		}
		return is_array( $value ) ? $value : array();
	}

	private static function table_exists( $name ) {
		global $wpdb;
		return $name === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $name ) ); // phpcs:ignore WordPress.DB
	}

	/** Site-wide settings found for a plugin, keyed by the KontrolWP setting they fill. */
	public static function read_settings( $source ) {
		$found = array();
		$text  = function ( $key, $value ) use ( &$found ) {
			if ( is_string( $value ) && '' !== trim( $value ) ) {
				$found[ $key ] = $value;
			}
		};
		switch ( $source ) {
			case 'yoast':
				$titles = self::option( 'wpseo_titles' );
				$social = self::option( 'wpseo_social' );
				$text( 'separator', self::map_separator( isset( $titles['separator'] ) ? $titles['separator'] : '' ) );
				$text( 'title_template', self::convert_tokens( isset( $titles['title-post'] ) ? $titles['title-post'] : '', $source ) );
				$text( 'home_title', self::convert_tokens( isset( $titles['title-home-wpseo'] ) ? $titles['title-home-wpseo'] : '', $source ) );
				$text( 'home_description', self::convert_tokens( isset( $titles['metadesc-home-wpseo'] ) ? $titles['metadesc-home-wpseo'] : '', $source ) );
				$text( 'og_image', isset( $social['og_default_image'] ) ? $social['og_default_image'] : '' );
				$text( 'twitter_site', isset( $social['twitter_site'] ) ? $social['twitter_site'] : '' );
				if ( ! empty( $titles['noindex-author-wpseo'] ) ) {
					$found['noindex_author'] = true;
				}
				if ( ! empty( $titles['noindex-archive-wpseo'] ) ) {
					$found['noindex_date'] = true;
				}
				self::yoast_more( $found, $titles, $social );
				break;
			case 'rankmath':
				$titles = self::option( 'rank-math-options-titles' );
				$text( 'separator', self::map_separator( isset( $titles['title_separator'] ) ? $titles['title_separator'] : '' ) );
				$text( 'title_template', self::convert_tokens( isset( $titles['pt_post_title'] ) ? $titles['pt_post_title'] : '', $source ) );
				$text( 'home_title', self::convert_tokens( isset( $titles['homepage_title'] ) ? $titles['homepage_title'] : '', $source ) );
				$text( 'home_description', self::convert_tokens( isset( $titles['homepage_description'] ) ? $titles['homepage_description'] : '', $source ) );
				$text( 'og_image', isset( $titles['open_graph_image'] ) ? $titles['open_graph_image'] : '' );
				if ( isset( $titles['author_robots'] ) && self::is_noindex( $titles['author_robots'] ) ) {
					$found['noindex_author'] = true;
				}
				if ( isset( $titles['date_archive_robots'] ) && self::is_noindex( $titles['date_archive_robots'] ) ) {
					$found['noindex_date'] = true;
				}
				self::rankmath_more( $found, $titles, self::option( 'rank-math-options-general' ) );
				break;
			case 'aioseo':
				$options = self::option( 'aioseo_options' );
				$text( 'separator', self::map_separator( (string) self::dig( $options, array( 'searchAppearance', 'global', 'separator' ) ) ) );
				$text( 'home_title', self::convert_tokens( (string) self::dig( $options, array( 'searchAppearance', 'global', 'siteTitle' ) ), $source ) );
				$text( 'home_description', self::convert_tokens( (string) self::dig( $options, array( 'searchAppearance', 'global', 'metaDescription' ) ), $source ) );
				$text( 'og_image', self::dig( $options, array( 'social', 'facebook', 'general', 'defaultImagePosts' ) ) );
				self::aioseo_more( $found, $options );
				break;
			case 'seopress':
				$titles = self::option( 'seopress_titles_option_name' );
				$social = self::option( 'seopress_social_option_name' );
				$text( 'home_title', self::convert_tokens( isset( $titles['seopress_titles_home_site_title'] ) ? $titles['seopress_titles_home_site_title'] : '', $source ) );
				$text( 'home_description', self::convert_tokens( isset( $titles['seopress_titles_home_site_desc'] ) ? $titles['seopress_titles_home_site_desc'] : '', $source ) );
				$text( 'og_image', isset( $social['seopress_social_facebook_img'] ) ? $social['seopress_social_facebook_img'] : '' );
				if ( ! empty( $titles['seopress_titles_archives_author_noindex'] ) ) {
					$found['noindex_author'] = true;
				}
				if ( ! empty( $titles['seopress_titles_archives_date_noindex'] ) ) {
					$found['noindex_date'] = true;
				}
				self::seopress_more( $found, self::option( 'seopress_advanced_option_name' ) );
				break;
			case 'slimseo':
				$options = self::option( 'slim_seo' );
				$text( 'og_image', isset( $options['default_facebook_image'] ) ? $options['default_facebook_image'] : ( isset( $options['default_twitter_image'] ) ? $options['default_twitter_image'] : '' ) );
				break;
		}
		return $found;
	}

	/** Public post types (without media) and taxonomies, for settings another plugin keeps per type. */
	private static function public_types() {
		$types = array_keys( get_post_types( array( 'public' => true ) ) );
		return array_values( array_diff( $types, array( 'attachment' ) ) );
	}

	private static function public_taxonomies() {
		return array_keys( get_taxonomies( array( 'public' => true ) ) );
	}

	/** A text setting into $found under a dotted key, when it has a value. */
	private static function put( &$found, $key, $value ) {
		if ( is_string( $value ) && '' !== trim( $value ) ) {
			$found[ $key ] = trim( $value );
		}
	}

	/** Verification codes for the sites of the search engines KontrolWP has a field for. */
	private static function put_codes( &$found, $codes ) {
		foreach ( $codes as $service => $code ) {
			$clean = KontrolWP_Connect_SEO_Tools::clean_code( is_string( $code ) ? $code : '' );
			if ( '' !== $clean ) {
				$found[ 'tools.verify.' . $service ] = $clean;
			}
		}
	}

	/** Type templates, but only those that say something the site-wide template does not. */
	private static function put_templates( &$found, $templates, $global ) {
		$out = array();
		foreach ( $templates as $type => $item ) {
			$title = isset( $item['title'] ) ? $item['title'] : '';
			$desc  = isset( $item['description'] ) ? $item['description'] : '';
			if ( $title === $global ) {
				$title = '';
			}
			if ( '' !== $title || '' !== $desc ) {
				$out[ $type ] = array(
					'title'       => $title,
					'description' => $desc,
				);
			}
		}
		if ( $out ) {
			$found['type_templates'] = $out;
		}
	}

	private static function yoast_more( &$found, $titles, $social ) {
		$wpseo = self::option( 'wpseo' );
		$card  = self::card_type( isset( $social['twitter_card_type'] ) ? $social['twitter_card_type'] : '' );
		if ( '' !== $card ) {
			$found['twitter_card'] = $card;
		}
		self::put_codes(
			$found,
			array(
				'google'    => isset( $wpseo['googleverify'] ) ? $wpseo['googleverify'] : '',
				'bing'      => isset( $wpseo['msverify'] ) ? $wpseo['msverify'] : '',
				'yandex'    => isset( $wpseo['yandexverify'] ) ? $wpseo['yandexverify'] : '',
				'baidu'     => isset( $wpseo['baiduverify'] ) ? $wpseo['baiduverify'] : '',
				'pinterest' => isset( $social['pinterestverify'] ) ? $social['pinterestverify'] : '',
			)
		);
		$hidden_types = array();
		$templates    = array();
		$global       = self::convert_tokens( isset( $titles['title-post'] ) ? $titles['title-post'] : '', 'yoast' );
		foreach ( self::public_types() as $type ) {
			if ( ! empty( $titles[ 'noindex-' . $type ] ) ) {
				$hidden_types[] = $type;
			}
			$templates[ $type ] = array(
				'title'       => self::convert_tokens( isset( $titles[ 'title-' . $type ] ) ? $titles[ 'title-' . $type ] : '', 'yoast' ),
				'description' => self::convert_tokens( isset( $titles[ 'metadesc-' . $type ] ) ? $titles[ 'metadesc-' . $type ] : '', 'yoast' ),
			);
		}
		$hidden_taxonomies = array();
		foreach ( self::public_taxonomies() as $taxonomy ) {
			if ( ! empty( $titles[ 'noindex-tax-' . $taxonomy ] ) ) {
				$hidden_taxonomies[] = $taxonomy;
			}
		}
		if ( $hidden_types ) {
			$found['hidden_types'] = $hidden_types;
		}
		if ( $hidden_taxonomies ) {
			$found['hidden_taxonomies'] = $hidden_taxonomies;
		}
		self::put_templates( $found, $templates, $global );
		if ( ! empty( $titles['stripcategorybase'] ) ) {
			$found['strip_category_base'] = true;
		}
		if ( ! empty( $titles['disable-author'] ) ) {
			$found['author_archives'] = 'redirect';
		}
		$kind = self::schema_kind( isset( $titles['company_or_person'] ) ? $titles['company_or_person'] : '' );
		if ( '' !== $kind ) {
			$found['content.schema_type'] = $kind;
			$prefix                       = 'person' === $kind ? 'person' : 'company';
			self::put( $found, 'content.schema_name', isset( $titles[ $prefix . '_name' ] ) ? $titles[ $prefix . '_name' ] : '' );
			self::put( $found, 'content.schema_logo', isset( $titles[ $prefix . '_logo' ] ) ? $titles[ $prefix . '_logo' ] : '' );
		}
		$profiles = array( self::handle_url( isset( $social['twitter_site'] ) ? $social['twitter_site'] : '' ) );
		foreach ( array( 'facebook_site', 'instagram_url', 'linkedin_url', 'youtube_url', 'pinterest_url', 'wikipedia_url', 'mastodon_url', 'myspace_url' ) as $key ) {
			$profiles[] = isset( $social[ $key ] ) ? $social[ $key ] : '';
		}
		$profiles[] = isset( $social['other_social_urls'] ) ? $social['other_social_urls'] : array();
		$links      = self::web_addresses( $profiles );
		if ( $links ) {
			$found['content.schema_same_as'] = $links;
		}
		self::put( $found, 'content.breadcrumb_home', isset( $titles['breadcrumbs-home'] ) ? $titles['breadcrumbs-home'] : '' );
		self::put( $found, 'content.breadcrumb_sep', isset( $titles['breadcrumbs-sep'] ) ? self::entity_text( $titles['breadcrumbs-sep'] ) : '' );
	}

	private static function rankmath_more( &$found, $titles, $general ) {
		$card = self::card_type( isset( $titles['twitter_card_type'] ) ? $titles['twitter_card_type'] : '' );
		if ( '' !== $card ) {
			$found['twitter_card'] = $card;
		}
		self::put( $found, 'twitter_site', isset( $titles['twitter_author_names'] ) ? $titles['twitter_author_names'] : '' );
		self::put_codes(
			$found,
			array(
				'google'    => isset( $general['google_verify'] ) ? $general['google_verify'] : '',
				'bing'      => isset( $general['bing_verify'] ) ? $general['bing_verify'] : '',
				'yandex'    => isset( $general['yandex_verify'] ) ? $general['yandex_verify'] : '',
				'baidu'     => isset( $general['baidu_verify'] ) ? $general['baidu_verify'] : '',
				'pinterest' => isset( $general['pinterest_verify'] ) ? $general['pinterest_verify'] : '',
			)
		);
		$hidden_types = array();
		$templates    = array();
		$global       = self::convert_tokens( isset( $titles['pt_post_title'] ) ? $titles['pt_post_title'] : '', 'rankmath' );
		foreach ( self::public_types() as $type ) {
			if ( isset( $titles[ 'pt_' . $type . '_robots' ] ) && self::is_noindex( $titles[ 'pt_' . $type . '_robots' ] ) ) {
				$hidden_types[] = $type;
			}
			$templates[ $type ] = array(
				'title'       => self::convert_tokens( isset( $titles[ 'pt_' . $type . '_title' ] ) ? $titles[ 'pt_' . $type . '_title' ] : '', 'rankmath' ),
				'description' => self::convert_tokens( isset( $titles[ 'pt_' . $type . '_description' ] ) ? $titles[ 'pt_' . $type . '_description' ] : '', 'rankmath' ),
			);
		}
		$hidden_taxonomies = array();
		foreach ( self::public_taxonomies() as $taxonomy ) {
			if ( isset( $titles[ 'tax_' . $taxonomy . '_robots' ] ) && self::is_noindex( $titles[ 'tax_' . $taxonomy . '_robots' ] ) ) {
				$hidden_taxonomies[] = $taxonomy;
			}
		}
		if ( $hidden_types ) {
			$found['hidden_types'] = $hidden_types;
		}
		if ( $hidden_taxonomies ) {
			$found['hidden_taxonomies'] = $hidden_taxonomies;
		}
		self::put_templates( $found, $templates, $global );
		if ( isset( $general['strip_category_base'] ) && 'on' === $general['strip_category_base'] ) {
			$found['strip_category_base'] = true;
		}
		if ( isset( $titles['disable_author_archives'] ) && 'on' === $titles['disable_author_archives'] ) {
			$found['author_archives'] = 'redirect';
		}
		$kind = self::schema_kind( isset( $titles['knowledgegraph_type'] ) ? $titles['knowledgegraph_type'] : '' );
		if ( '' !== $kind ) {
			$found['content.schema_type'] = $kind;
			self::put( $found, 'content.schema_name', isset( $titles['knowledgegraph_name'] ) ? $titles['knowledgegraph_name'] : '' );
			self::put( $found, 'content.schema_logo', isset( $titles['knowledgegraph_logo'] ) ? $titles['knowledgegraph_logo'] : '' );
		}
		$links = self::web_addresses(
			array(
				isset( $titles['social_url_facebook'] ) ? $titles['social_url_facebook'] : '',
				self::handle_url( isset( $titles['twitter_author_names'] ) ? $titles['twitter_author_names'] : '' ),
				isset( $titles['social_additional_profiles'] ) ? $titles['social_additional_profiles'] : '',
			)
		);
		if ( $links ) {
			$found['content.schema_same_as'] = $links;
		}
		self::put( $found, 'content.breadcrumb_home', isset( $general['breadcrumbs_home_label'] ) ? $general['breadcrumbs_home_label'] : '' );
		self::put( $found, 'content.breadcrumb_sep', isset( $general['breadcrumbs_separator'] ) ? self::entity_text( $general['breadcrumbs_separator'] ) : '' );
		if ( isset( $general['new_window_external_links'] ) && 'on' === $general['new_window_external_links'] ) {
			$found['content.external_new_tab'] = true;
		}
		if ( isset( $general['nofollow_external_links'] ) && 'on' === $general['nofollow_external_links'] ) {
			$found['content.external_nofollow'] = true;
		}
		if ( isset( $general['robots_txt_content'] ) && is_string( $general['robots_txt_content'] ) && '' !== trim( $general['robots_txt_content'] ) ) {
			$found['tools.robots_text'] = $general['robots_txt_content'];
		}
	}

	private static function aioseo_more( &$found, $options ) {
		$card = self::card_type( (string) self::dig( $options, array( 'social', 'twitter', 'general', 'defaultCardType' ) ) );
		if ( '' !== $card ) {
			$found['twitter_card'] = $card;
		}
		self::put_codes(
			$found,
			array(
				'google'    => self::dig( $options, array( 'webmasterTools', 'google' ) ),
				'bing'      => self::dig( $options, array( 'webmasterTools', 'bing' ) ),
				'yandex'    => self::dig( $options, array( 'webmasterTools', 'yandex' ) ),
				'baidu'     => self::dig( $options, array( 'webmasterTools', 'baidu' ) ),
				'pinterest' => self::dig( $options, array( 'webmasterTools', 'pinterest' ) ),
			)
		);
		if ( true === self::dig( $options, array( 'searchAppearance', 'advanced', 'removeCategoryBase' ) ) ) {
			$found['strip_category_base'] = true;
		}
		$kind = self::schema_kind( (string) self::dig( $options, array( 'searchAppearance', 'global', 'schema', 'siteRepresents' ) ) );
		if ( '' !== $kind ) {
			$found['content.schema_type'] = $kind;
			$prefix                       = 'person' === $kind ? 'person' : 'organization';
			$name                         = self::dig( $options, array( 'searchAppearance', 'global', 'schema', $prefix . 'Name' ) );
			// A value with a smart tag (#site_title) is a template, not a name.
			if ( is_string( $name ) && false === strpos( $name, '#' ) ) {
				self::put( $found, 'content.schema_name', $name );
			}
			self::put( $found, 'content.schema_logo', self::dig( $options, array( 'searchAppearance', 'global', 'schema', $prefix . 'Logo' ) ) );
		}
		$urls  = self::dig( $options, array( 'social', 'profiles', 'urls' ) );
		$links = self::web_addresses( is_array( $urls ) ? array_values( $urls ) : array() );
		if ( $links ) {
			$found['content.schema_same_as'] = $links;
		}
		self::put( $found, 'content.breadcrumb_home', self::dig( $options, array( 'breadcrumbs', 'homepageLabel' ) ) );
		self::put( $found, 'content.breadcrumb_sep', self::entity_text( (string) self::dig( $options, array( 'breadcrumbs', 'separator' ) ) ) );
	}

	/** SEOPress keeps its verification codes with its advanced settings. */
	private static function seopress_more( &$found, $advanced ) {
		self::put_codes(
			$found,
			array(
				'google'    => isset( $advanced['seopress_advanced_advanced_google'] ) ? $advanced['seopress_advanced_advanced_google'] : '',
				'bing'      => isset( $advanced['seopress_advanced_advanced_bing'] ) ? $advanced['seopress_advanced_advanced_bing'] : '',
				'yandex'    => isset( $advanced['seopress_advanced_advanced_yandex'] ) ? $advanced['seopress_advanced_advanced_yandex'] : '',
				'pinterest' => isset( $advanced['seopress_advanced_advanced_pinterest'] ) ? $advanced['seopress_advanced_advanced_pinterest'] : '',
			)
		);
	}

	/**
	 * Per-page title, description, hidden-from-search flag and social image,
	 * and focus keyword, as rows of array( post_id, title, description, noindex, image, keyword ).
	 * Returns array( rows, truncated ).
	 */
	public static function read_pages( $source ) {
		global $wpdb;
		if ( 'aioseo' === $source ) {
			return self::read_aioseo_pages();
		}
		$keys = array(
			'yoast'    => array(
				'title'       => '_yoast_wpseo_title',
				'description' => '_yoast_wpseo_metadesc',
				'noindex'     => '_yoast_wpseo_meta-robots-noindex',
				'image'       => '_yoast_wpseo_opengraph-image',
				'keyword'     => '_yoast_wpseo_focuskw',
			),
			'rankmath' => array(
				'title'       => 'rank_math_title',
				'description' => 'rank_math_description',
				'noindex'     => 'rank_math_robots',
				'image'       => 'rank_math_facebook_image',
				'keyword'     => 'rank_math_focus_keyword',
			),
			'seopress' => array(
				'title'       => '_seopress_titles_title',
				'description' => '_seopress_titles_desc',
				'noindex'     => '_seopress_robots_index',
				'image'       => '_seopress_social_fb_img',
				'keyword'     => '_seopress_analysis_target_kw',
			),
			'slimseo'  => array( 'bundle' => 'slim_seo' ),
		);
		if ( ! isset( $keys[ $source ] ) ) {
			return array( array(), false );
		}
		$map          = $keys[ $source ];
		$names        = array_values( $map );
		$placeholders = implode( ',', array_fill( 0, count( $names ), '%s' ) );
		$sql          = "SELECT m.post_id, m.meta_key, m.meta_value FROM {$wpdb->postmeta} m JOIN {$wpdb->posts} p ON p.ID = m.post_id WHERE m.meta_key IN ($placeholders) AND p.post_status NOT IN ('auto-draft', 'inherit', 'trash') ORDER BY m.post_id LIMIT %d";
		$rows         = $wpdb->get_results( $wpdb->prepare( $sql, array_merge( $names, array( self::MAX_META_ROWS + 1 ) ) ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$rows         = is_array( $rows ) ? $rows : array();
		$truncated    = count( $rows ) > self::MAX_META_ROWS;
		$pages        = array();
		foreach ( array_slice( $rows, 0, self::MAX_META_ROWS ) as $row ) {
			$id   = (int) $row['post_id'];
			$page = isset( $pages[ $id ] ) ? $pages[ $id ] : array( $id, '', '', false, '', '' );
			$raw  = maybe_unserialize( $row['meta_value'] );
			if ( isset( $map['bundle'] ) ) {
				if ( is_array( $raw ) ) {
					$page[1] = isset( $raw['title'] ) ? (string) $raw['title'] : '';
					$page[2] = isset( $raw['description'] ) ? (string) $raw['description'] : '';
					$page[3] = ! empty( $raw['noindex'] );
					$page[4] = isset( $raw['facebook_image'] ) ? (string) $raw['facebook_image'] : '';
				}
			} elseif ( $row['meta_key'] === $map['title'] ) {
				$page[1] = (string) $raw;
			} elseif ( $row['meta_key'] === $map['description'] ) {
				$page[2] = (string) $raw;
			} elseif ( $row['meta_key'] === $map['noindex'] ) {
				$page[3] = self::is_noindex( $raw );
			} elseif ( $row['meta_key'] === $map['image'] ) {
				$page[4] = (string) $raw;
			} elseif ( isset( $map['keyword'] ) && $row['meta_key'] === $map['keyword'] ) {
				$page[5] = self::first_keyword( is_string( $raw ) ? $raw : '' );
			}
			$pages[ $id ] = $page;
		}
		return array( self::convert_pages( array_values( $pages ), $source ), $truncated );
	}

	private static function read_aioseo_pages() {
		global $wpdb;
		$table = $wpdb->prefix . 'aioseo_posts';
		if ( ! self::table_exists( $table ) ) {
			return array( array(), false );
		}
		// Newer versions keep the focus keyword in its own column, older ones in the keyphrases JSON.
		$has_focus = (bool) $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$table} LIKE %s", 'focus_keyword' ) ); // phpcs:ignore WordPress.DB
		$keyword   = $has_focus ? 'focus_keyword AS focus, keyphrases' : "'' AS focus, keyphrases";
		$rows      = $wpdb->get_results( $wpdb->prepare( "SELECT post_id, title, description, robots_default, robots_noindex, og_image_custom_url, {$keyword} FROM {$table} LIMIT %d", self::MAX_META_ROWS + 1 ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$rows = is_array( $rows ) ? $rows : array();
		$out  = array();
		foreach ( array_slice( $rows, 0, self::MAX_META_ROWS ) as $row ) {
			$out[] = array(
				(int) $row['post_id'],
				(string) $row['title'],
				(string) $row['description'],
				empty( $row['robots_default'] ) && ! empty( $row['robots_noindex'] ),
				(string) $row['og_image_custom_url'],
				self::aioseo_keyword( $row ),
			);
		}
		return array( self::convert_pages( $out, 'aioseo' ), count( $rows ) > self::MAX_META_ROWS );
	}

	/** An All in One SEO row's focus keyword: its own column, or the legacy keyphrases JSON. */
	public static function aioseo_keyword( $row ) {
		if ( ! empty( $row['focus'] ) && is_string( $row['focus'] ) ) {
			return self::first_keyword( $row['focus'] );
		}
		$phrases = isset( $row['keyphrases'] ) && is_string( $row['keyphrases'] ) ? json_decode( $row['keyphrases'], true ) : null;
		$focus   = self::dig( is_array( $phrases ) ? $phrases : array(), array( 'focus', 'keyphrase' ) );
		return is_string( $focus ) ? self::first_keyword( $focus ) : '';
	}

	/** Titles and descriptions into KontrolWP's tokens, and rows with nothing to import left out. */
	private static function convert_pages( $rows, $source ) {
		$out = array();
		foreach ( $rows as $row ) {
			$row[1] = self::convert_tokens( $row[1], $source );
			$row[2] = self::convert_tokens( $row[2], $source );
			if ( '' !== $row[1] || '' !== $row[2] || $row[3] || '' !== $row[4] || '' !== $row[5] ) {
				$out[] = $row;
			}
		}
		return $out;
	}

	/** Redirection rules in the shape KontrolWP imports; some may be refused when imported. */
	public static function read_redirects( $source ) {
		global $wpdb;
		$rules = array();
		switch ( $source ) {
			case 'rankmath':
				$table = $wpdb->prefix . 'rank_math_redirections';
				if ( self::table_exists( $table ) ) {
					$rows = $wpdb->get_results( "SELECT sources, url_to, header_code, status FROM {$table} LIMIT 5000", ARRAY_A ); // phpcs:ignore WordPress.DB
					foreach ( is_array( $rows ) ? $rows : array() as $row ) {
						$rules = array_merge( $rules, self::rankmath_rules( $row ) );
					}
				}
				break;
			case 'yoast':
				$saved = get_option( 'wpseo-premium-redirects-base', array() );
				foreach ( is_array( $saved ) ? $saved : array() as $item ) {
					if ( ! is_array( $item ) || empty( $item['origin'] ) ) {
						continue;
					}
					$rules[] = array(
						'source'      => (string) $item['origin'],
						'match_type'  => isset( $item['format'] ) && 'regex' === $item['format'] ? 'regex' : 'exact',
						'target'      => isset( $item['url'] ) ? (string) $item['url'] : '',
						'status_code' => isset( $item['type'] ) ? (int) $item['type'] : 301,
						'enabled'     => true,
					);
				}
				break;
			case 'aioseo':
				$table = $wpdb->prefix . 'aioseo_redirects';
				if ( self::table_exists( $table ) ) {
					$rows = $wpdb->get_results( "SELECT source_url, target_url, type, regex, enabled FROM {$table} LIMIT 5000", ARRAY_A ); // phpcs:ignore WordPress.DB
					foreach ( is_array( $rows ) ? $rows : array() as $row ) {
						$rules[] = array(
							'source'      => (string) $row['source_url'],
							'match_type'  => ! empty( $row['regex'] ) ? 'regex' : 'exact',
							'target'      => (string) $row['target_url'],
							'status_code' => (int) $row['type'],
							'enabled'     => ! empty( $row['enabled'] ),
						);
					}
				}
				break;
			case 'seopress':
				$posts = get_posts(
					array(
						'post_type'      => 'seopress_404',
						'post_status'    => array( 'publish', 'draft' ),
						'posts_per_page' => 5000,
						'orderby'        => 'ID',
						'order'          => 'ASC',
					)
				);
				foreach ( $posts as $post ) {
					$regex   = 'yes' === get_post_meta( $post->ID, '_seopress_redirections_enabled_regex', true );
					$rules[] = array(
						'source'      => (string) $post->post_title,
						'match_type'  => $regex ? 'regex' : 'exact',
						'target'      => (string) get_post_meta( $post->ID, '_seopress_redirections_value', true ),
						'status_code' => (int) get_post_meta( $post->ID, '_seopress_redirections_type', true ),
						'enabled'     => 'publish' === $post->post_status && 'yes' === get_post_meta( $post->ID, '_seopress_redirections_enabled', true ),
					);
				}
				break;
		}
		return $rules;
	}

	/* ---- Dashboard routes ---- */

	/** What importing from a plugin would do, without changing anything. */
	public static function preview( $request ) {
		$source = self::source_from( $request );
		if ( '' === $source ) {
			return self::unknown_source();
		}
		$settings = array();
		foreach ( self::read_settings( $source ) as $key => $value ) {
			$settings[] = array(
				'key'   => $key,
				'value' => self::describe( $value ),
			);
		}

		list( $pages, $truncated ) = self::read_pages( $source );
		$counts                    = array(
			'total'        => count( $pages ),
			'titles'       => 0,
			'descriptions' => 0,
			'noindex'      => 0,
			'images'       => 0,
			'keywords'     => 0,
			'existing'     => 0,
		);
		foreach ( $pages as $row ) {
			$counts['titles']       += '' !== $row[1] ? 1 : 0;
			$counts['descriptions'] += '' !== $row[2] ? 1 : 0;
			$counts['noindex']      += $row[3] ? 1 : 0;
			$counts['images']       += '' !== $row[4] ? 1 : 0;
			$counts['keywords']     += '' !== $row[5] ? 1 : 0;
			if ( self::has_kontrolwp_meta( $row[0] ) ) {
				++$counts['existing'];
			}
		}
		$counts['truncated'] = $truncated;

		$rules      = self::read_redirects( $source );
		$importable = 0;
		$samples    = array();
		foreach ( $rules as $rule ) {
			list( $clean, ) = KontrolWP_Connect_Redirects::clean_rule( $rule );
			if ( $clean ) {
				++$importable;
				if ( count( $samples ) < 5 ) {
					$samples[] = $clean;
				}
			}
		}

		$files = self::files_of( $source );
		return array(
			'source'    => $source,
			'name'      => self::SOURCES[ $source ]['name'],
			'active'    => in_array( true, $files, true ),
			'enabled'   => (bool) KontrolWP_Connect_SEO::settings()['enabled'],
			'settings'  => $settings,
			'pages'     => $counts,
			'redirects' => array(
				'total'      => count( $rules ),
				'importable' => $importable,
				'samples'    => $samples,
			),
		);
	}

	/** A found setting as the preview shows it. */
	public static function describe( $value ) {
		if ( is_bool( $value ) ) {
			return 'On';
		}
		if ( is_array( $value ) ) {
			$names = array();
			foreach ( $value as $key => $item ) {
				$names[] = is_array( $item ) ? (string) $key : (string) $item;
			}
			$value = implode( ', ', $names );
		}
		$value = (string) $value;
		return function_exists( 'mb_substr' ) ? mb_substr( $value, 0, 120 ) : substr( $value, 0, 120 );
	}

	private static function has_kontrolwp_meta( $post_id ) {
		foreach ( array( KontrolWP_Connect_SEO::META_TITLE, KontrolWP_Connect_SEO::META_DESCRIPTION, KontrolWP_Connect_SEO::META_NOINDEX, KontrolWP_Connect_SEO::META_IMAGE, KontrolWP_Connect_SEO_Score::META_KEYWORD ) as $key ) {
			if ( '' !== (string) get_post_meta( $post_id, $key, true ) ) {
				return true;
			}
		}
		return false;
	}

	/** Import the chosen parts. Adds only; see the class notes. */
	public static function run( $request ) {
		$source = self::source_from( $request );
		if ( '' === $source ) {
			return self::unknown_source();
		}
		$result = array(
			'settings'  => array(),
			'pages'     => array(
				'updated' => 0,
				'skipped' => 0,
			),
			'redirects' => array(
				'added'   => 0,
				'skipped' => 0,
				'errors'  => array(),
			),
		);

		if ( $request->get_param( 'settings' ) ) {
			$result['settings'] = self::apply_settings( self::read_settings( $source ) );
		}
		if ( $request->get_param( 'pages' ) ) {
			list( $pages, ) = self::read_pages( $source );
			foreach ( $pages as $row ) {
				if ( self::apply_page( $row ) ) {
					++$result['pages']['updated'];
				} else {
					++$result['pages']['skipped'];
				}
			}
		}
		if ( $request->get_param( 'redirects' ) ) {
			$result['redirects'] = KontrolWP_Connect_Redirects::import_rules( self::read_redirects( $source ) );
		}
		return $result;
	}

	/**
	 * Fill KontrolWP's settings from another plugin's, and turn KontrolWP's tags
	 * on (they stay off until then). Text settings are filled only where
	 * KontrolWP still has its default, and hiding is only ever switched on, so
	 * running this again keeps what was changed since. Returns the names of the
	 * settings changed.
	 */
	private static function apply_settings( $found ) {
		$content = array();
		$tools   = array();
		$seo     = array();
		foreach ( $found as $key => $value ) {
			if ( 0 === strpos( $key, 'content.' ) ) {
				$content[ substr( $key, 8 ) ] = $value;
			} elseif ( 0 === strpos( $key, 'tools.' ) ) {
				$tools[ substr( $key, 6 ) ] = $value;
			} else {
				$seo[ $key ] = $value;
			}
		}

		$current = KontrolWP_Connect_SEO::settings();
		$new     = $current;
		$changed = array();
		foreach ( $seo as $key => $value ) {
			if ( is_bool( $value ) ) {
				if ( ! $current[ $key ] ) {
					$new[ $key ] = true;
					$changed[]   = $key;
				}
			} elseif ( 'type_templates' === $key ) {
				$new[ $key ] = self::merge_templates( $current[ $key ], $value );
				if ( $new[ $key ] !== $current[ $key ] ) {
					$changed[] = $key;
				}
			} elseif ( is_array( $value ) ) {
				$new[ $key ] = self::merge_list( $current[ $key ], $value );
				if ( $new[ $key ] !== $current[ $key ] ) {
					$changed[] = $key;
				}
			} elseif ( $current[ $key ] === KontrolWP_Connect_SEO::DEFAULTS[ $key ] ) {
				$new[ $key ] = $value;
				$changed[]   = $key;
			}
		}
		$new['enabled'] = true;
		$new            = KontrolWP_Connect_SEO::clean( $new );
		foreach ( $changed as $key ) {
			if ( $new[ $key ] === $current[ $key ] ) {
				$changed = array_values( array_diff( $changed, array( $key ) ) );
			}
		}
		update_option( KontrolWP_Connect_SEO::OPTION, $new, true );

		if ( $content ) {
			$before                 = KontrolWP_Connect_SEO_Content::settings();
			list( $merged, $names ) = self::merge_content( $before, KontrolWP_Connect_SEO_Content::DEFAULTS, $content );
			$merged                 = KontrolWP_Connect_SEO_Content::clean( $merged );
			foreach ( $names as $name ) {
				if ( $merged[ $name ] !== $before[ $name ] ) {
					$changed[] = 'content.' . $name;
				}
			}
			update_option( KontrolWP_Connect_SEO_Content::OPTION, $merged, true );
		}
		if ( $tools ) {
			foreach ( KontrolWP_Connect_SEO_Tools::import( $tools ) as $name ) {
				$changed[] = 'tools.' . $name;
			}
		}
		return $changed;
	}

	/** Write one page's values where KontrolWP has none. True when anything was written. */
	private static function apply_page( $row ) {
		list( $id, $title, $description, $noindex, $image, $keyword ) = $row;
		if ( ! get_post( $id ) ) {
			return false;
		}
		$wrote = false;
		$set   = function ( $key, $value ) use ( $id, &$wrote ) {
			if ( '' !== $value && '' === (string) get_post_meta( $id, $key, true ) ) {
				update_post_meta( $id, $key, $value );
				$wrote = true;
			}
		};
		$set( KontrolWP_Connect_SEO::META_TITLE, KontrolWP_Connect_SEO::line( $title, 200 ) );
		$set( KontrolWP_Connect_SEO::META_DESCRIPTION, KontrolWP_Connect_SEO::line( $description, 320 ) );
		$set( KontrolWP_Connect_SEO::META_IMAGE, KontrolWP_Connect_SEO::url( $image ) );
		$set( KontrolWP_Connect_SEO_Score::META_KEYWORD, KontrolWP_Connect_SEO_Score::clean_keyword( $keyword ) );
		if ( $noindex ) {
			$set( KontrolWP_Connect_SEO::META_NOINDEX, '1' );
		}
		return $wrote;
	}

	/** Deactivate the plugin (and its add-on). It is never deleted, and its data stays. */
	public static function deactivate( $request ) {
		$source = self::source_from( $request );
		if ( '' === $source ) {
			return self::unknown_source();
		}
		$done = array();
		foreach ( self::files_of( $source ) as $file => $active ) {
			if ( $active ) {
				deactivate_plugins( $file, false, is_multisite() && is_plugin_active_for_network( $file ) );
				$done[] = $file;
			}
		}
		return array(
			'name'        => self::SOURCES[ $source ]['name'],
			'deactivated' => $done,
		);
	}
}
