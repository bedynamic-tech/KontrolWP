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
				break;
			case 'aioseo':
				$options = self::option( 'aioseo_options' );
				$text( 'separator', self::map_separator( (string) self::dig( $options, array( 'searchAppearance', 'global', 'separator' ) ) ) );
				$text( 'home_title', self::convert_tokens( (string) self::dig( $options, array( 'searchAppearance', 'global', 'siteTitle' ) ), $source ) );
				$text( 'home_description', self::convert_tokens( (string) self::dig( $options, array( 'searchAppearance', 'global', 'metaDescription' ) ), $source ) );
				$text( 'og_image', self::dig( $options, array( 'social', 'facebook', 'general', 'defaultImagePosts' ) ) );
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
				break;
			case 'slimseo':
				$options = self::option( 'slim_seo' );
				$text( 'og_image', isset( $options['default_facebook_image'] ) ? $options['default_facebook_image'] : ( isset( $options['default_twitter_image'] ) ? $options['default_twitter_image'] : '' ) );
				break;
		}
		return $found;
	}

	/**
	 * Per-page title, description, hidden-from-search flag and social image,
	 * as rows of array( post_id, title, description, noindex, image ).
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
			),
			'rankmath' => array(
				'title'       => 'rank_math_title',
				'description' => 'rank_math_description',
				'noindex'     => 'rank_math_robots',
				'image'       => 'rank_math_facebook_image',
			),
			'seopress' => array(
				'title'       => '_seopress_titles_title',
				'description' => '_seopress_titles_desc',
				'noindex'     => '_seopress_robots_index',
				'image'       => '_seopress_social_fb_img',
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
			$page = isset( $pages[ $id ] ) ? $pages[ $id ] : array( $id, '', '', false, '' );
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
		$rows = $wpdb->get_results( $wpdb->prepare( "SELECT post_id, title, description, robots_default, robots_noindex, og_image_custom_url FROM {$table} LIMIT %d", self::MAX_META_ROWS + 1 ), ARRAY_A ); // phpcs:ignore WordPress.DB
		$rows = is_array( $rows ) ? $rows : array();
		$out  = array();
		foreach ( array_slice( $rows, 0, self::MAX_META_ROWS ) as $row ) {
			$out[] = array(
				(int) $row['post_id'],
				(string) $row['title'],
				(string) $row['description'],
				empty( $row['robots_default'] ) && ! empty( $row['robots_noindex'] ),
				(string) $row['og_image_custom_url'],
			);
		}
		return array( self::convert_pages( $out, 'aioseo' ), count( $rows ) > self::MAX_META_ROWS );
	}

	/** Titles and descriptions into KontrolWP's tokens, and rows with nothing to import left out. */
	private static function convert_pages( $rows, $source ) {
		$out = array();
		foreach ( $rows as $row ) {
			$row[1] = self::convert_tokens( $row[1], $source );
			$row[2] = self::convert_tokens( $row[2], $source );
			if ( '' !== $row[1] || '' !== $row[2] || $row[3] || '' !== $row[4] ) {
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
				'value' => is_bool( $value ) ? 'Hide from search' : ( function_exists( 'mb_substr' ) ? mb_substr( (string) $value, 0, 120 ) : substr( (string) $value, 0, 120 ) ),
			);
		}

		list( $pages, $truncated ) = self::read_pages( $source );
		$counts                    = array(
			'total'        => count( $pages ),
			'titles'       => 0,
			'descriptions' => 0,
			'noindex'      => 0,
			'images'       => 0,
			'existing'     => 0,
		);
		foreach ( $pages as $row ) {
			$counts['titles']       += '' !== $row[1] ? 1 : 0;
			$counts['descriptions'] += '' !== $row[2] ? 1 : 0;
			$counts['noindex']      += $row[3] ? 1 : 0;
			$counts['images']       += '' !== $row[4] ? 1 : 0;
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

	private static function has_kontrolwp_meta( $post_id ) {
		foreach ( array( KontrolWP_Connect_SEO::META_TITLE, KontrolWP_Connect_SEO::META_DESCRIPTION, KontrolWP_Connect_SEO::META_NOINDEX, KontrolWP_Connect_SEO::META_IMAGE ) as $key ) {
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
		$current = KontrolWP_Connect_SEO::settings();
		$new     = $current;
		$changed = array();
		foreach ( $found as $key => $value ) {
			if ( is_bool( $value ) ) {
				if ( ! $current[ $key ] ) {
					$new[ $key ] = true;
					$changed[]   = $key;
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
		return $changed;
	}

	/** Write one page's values where KontrolWP has none. True when anything was written. */
	private static function apply_page( $row ) {
		list( $id, $title, $description, $noindex, $image ) = $row;
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
