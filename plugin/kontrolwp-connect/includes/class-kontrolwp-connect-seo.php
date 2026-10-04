<?php
/**
 * Basic SEO the dashboard's SEO tab can switch on (0.15.0): page titles and
 * meta descriptions from templates, per-page overrides, Open Graph and
 * Twitter tags, search visibility, canonical links and the core sitemap.
 *
 * Settings are one autoloaded option and the per-page overrides are post
 * meta, so nothing changes in the theme or the content itself. Turning SEO
 * off, or removing the plugin, leaves the site as WordPress alone would
 * render it. If another SEO plugin is active, this one prints nothing, so
 * pages never carry two sets of tags.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_SEO {

	const OPTION = 'kontrolwp_connect_seo';

	const META_TITLE       = '_kontrolwp_seo_title';
	const META_DESCRIPTION = '_kontrolwp_seo_description';
	const META_NOINDEX     = '_kontrolwp_seo_noindex';
	const META_IMAGE       = '_kontrolwp_seo_image';

	/** Longest description kept in a tag; search engines cut at about this. */
	const DESCRIPTION_LENGTH = 160;

	const SEPARATORS = array( '-', '|', '·', '»', '•' );

	const DEFAULTS = array(
		'enabled'            => false,
		'separator'          => '-',
		'title_template'     => '%title% %sep% %sitename%',
		'home_title'         => '',
		'home_description'   => '',
		'og_enabled'         => true,
		'og_image'           => '',
		'twitter_card'       => 'summary_large_image',
		'twitter_site'       => '',
		'noindex_search'     => true,
		'noindex_author'     => false,
		'noindex_date'       => true,
		'canonical'          => true,
		'sitemap'            => true,
	);

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		register_rest_route(
			$ns,
			'/seo',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'report' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			$ns,
			'/seo/settings',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'save_settings' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			$ns,
			'/seo/pages',
			array(
				// POST so the filters are in the signed body.
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'pages' ),
				'permission_callback' => $auth,
				'args'                => array(
					'page'   => array(
						'type'    => 'integer',
						'minimum' => 1,
						'default' => 1,
					),
					'search' => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);
		register_rest_route(
			$ns,
			'/seo/page',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'save_page' ),
				'permission_callback' => $auth,
				'args'                => array(
					'id' => array(
						'type'     => 'integer',
						'required' => true,
						'minimum'  => 1,
					),
				),
			)
		);
	}

	/* ---- Settings ---- */

	/** The saved settings with every missing value at its default. */
	public static function settings() {
		$saved = get_option( self::OPTION, array() );
		return self::clean( is_array( $saved ) ? $saved : array() );
	}

	/** A settings array with only known keys, each of the right type. Pure; used on input and on what is stored. */
	public static function clean( $input ) {
		$out = self::DEFAULTS;
		foreach ( array( 'enabled', 'og_enabled', 'noindex_search', 'noindex_author', 'noindex_date', 'canonical', 'sitemap' ) as $key ) {
			if ( array_key_exists( $key, $input ) ) {
				$out[ $key ] = (bool) $input[ $key ];
			}
		}
		if ( isset( $input['separator'] ) && in_array( $input['separator'], self::SEPARATORS, true ) ) {
			$out['separator'] = $input['separator'];
		}
		if ( isset( $input['twitter_card'] ) && in_array( $input['twitter_card'], array( 'summary', 'summary_large_image' ), true ) ) {
			$out['twitter_card'] = $input['twitter_card'];
		}
		foreach ( array( 'title_template', 'home_title' ) as $key ) {
			if ( isset( $input[ $key ] ) && is_string( $input[ $key ] ) ) {
				$out[ $key ] = self::line( $input[ $key ], 200 );
			}
		}
		if ( '' === $out['title_template'] ) {
			$out['title_template'] = self::DEFAULTS['title_template'];
		}
		if ( isset( $input['home_description'] ) && is_string( $input['home_description'] ) ) {
			$out['home_description'] = self::line( $input['home_description'], 320 );
		}
		if ( isset( $input['og_image'] ) && is_string( $input['og_image'] ) ) {
			$out['og_image'] = self::url( $input['og_image'] );
		}
		if ( isset( $input['twitter_site'] ) && is_string( $input['twitter_site'] ) ) {
			$handle                = ltrim( trim( $input['twitter_site'] ), '@' );
			$out['twitter_site'] = preg_match( '/^[A-Za-z0-9_]{1,15}$/', $handle ) ? '@' . $handle : '';
		}
		return $out;
	}

	/** Plain text on one line, cut to a length. */
	private static function line( $text, $max ) {
		$text = wp_strip_all_tags( $text );
		$text = trim( preg_replace( '/\s+/u', ' ', $text ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max ) : substr( $text, 0, $max );
	}

	/** An http or https address, or an empty string. */
	private static function url( $value ) {
		$value = trim( $value );
		return preg_match( '#^https?://[^\s<>"\']+$#i', $value ) ? $value : '';
	}

	/** The name of another SEO plugin that is active, or an empty string. */
	public static function conflict() {
		$known = array(
			'WPSEO_VERSION'      => 'Yoast SEO',
			'RANK_MATH_VERSION'  => 'Rank Math',
			'AIOSEO_VERSION'     => 'All in One SEO',
			'SEOPRESS_VERSION'   => 'SEOPress',
			'THE_SEO_FRAMEWORK_VERSION' => 'The SEO Framework',
			'SLIM_SEO_VER'      => 'Slim SEO',
		);
		foreach ( $known as $constant => $name ) {
			if ( defined( $constant ) ) {
				return $name;
			}
		}
		return '';
	}

	/** Whether this plugin is printing tags: switched on and no other SEO plugin is. */
	private static function active( $settings ) {
		return ! empty( $settings['enabled'] ) && '' === self::conflict();
	}

	/* ---- Pure helpers (tested outside WordPress) ---- */

	/** Fill a title template. Unknown tokens are dropped. */
	public static function fill_template( $template, $vars ) {
		$out = preg_replace_callback(
			'/%(title|sitename|tagline|sep)%/',
			function ( $m ) use ( $vars ) {
				return isset( $vars[ $m[1] ] ) ? $vars[ $m[1] ] : '';
			},
			$template
		);
		$out = preg_replace( '/\s+/u', ' ', $out );
		return trim( $out );
	}

	/** Plain text cut at a word boundary to the description length, with an ellipsis when cut. */
	public static function trim_description( $text, $max = self::DESCRIPTION_LENGTH ) {
		$text = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( strip_shortcodes( $text ) ) ) );
		$len  = function_exists( 'mb_strlen' ) ? mb_strlen( $text ) : strlen( $text );
		if ( $len <= $max ) {
			return $text;
		}
		$cut   = function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max - 1 ) : substr( $text, 0, $max - 1 );
		$space = strrpos( $cut, ' ' );
		if ( false !== $space && $space > $max / 2 ) {
			$cut = substr( $cut, 0, $space );
		}
		return rtrim( $cut, " ,.;:-" ) . '…';
	}

	/**
	 * The tags for one page. $page keys: kind (home, singular, term, other),
	 * title, description, url, image, type (website or article), noindex,
	 * site_name, tagline, locale. Returns the HTML for the head.
	 */
	public static function head_html( $settings, $page ) {
		$tags = array();
		$esc  = function ( $value ) {
			return htmlspecialchars( (string) $value, ENT_QUOTES, 'UTF-8' );
		};
		$meta = function ( $attr, $name, $content ) use ( &$tags, $esc ) {
			if ( '' !== (string) $content ) {
				$tags[] = '<meta ' . $attr . '="' . $esc( $name ) . '" content="' . $esc( $content ) . '" />';
			}
		};

		$meta( 'name', 'description', $page['description'] );
		if ( $settings['canonical'] && ! empty( $page['url'] ) && ! $page['noindex'] ) {
			$tags[] = '<link rel="canonical" href="' . $esc( $page['url'] ) . '" />';
		}
		if ( $settings['og_enabled'] ) {
			$meta( 'property', 'og:locale', $page['locale'] );
			$meta( 'property', 'og:type', $page['type'] );
			$meta( 'property', 'og:title', $page['title'] );
			$meta( 'property', 'og:description', $page['description'] );
			$meta( 'property', 'og:url', $page['url'] );
			$meta( 'property', 'og:site_name', $page['site_name'] );
			$meta( 'property', 'og:image', $page['image'] );
			$meta( 'name', 'twitter:card', $page['image'] ? $settings['twitter_card'] : 'summary' );
			$meta( 'name', 'twitter:title', $page['title'] );
			$meta( 'name', 'twitter:description', $page['description'] );
			$meta( 'name', 'twitter:image', $page['image'] );
			$meta( 'name', 'twitter:site', $settings['twitter_site'] );
		}
		return $tags ? "<!-- KontrolWP SEO -->\n" . implode( "\n", $tags ) . "\n<!-- /KontrolWP SEO -->\n" : '';
	}

	/* ---- Front end ---- */

	/** Hook into the front end when SEO is on. Runs every time the plugin loads. */
	public static function boot() {
		$settings = self::settings();
		if ( ! self::active( $settings ) ) {
			return;
		}
		add_filter( 'document_title_separator', array( __CLASS__, 'filter_separator' ), 20 );
		add_filter( 'pre_get_document_title', array( __CLASS__, 'filter_title' ), 20 );
		add_action( 'wp_head', array( __CLASS__, 'print_head' ), 1 );
		add_filter( 'wp_robots', array( __CLASS__, 'filter_robots' ), 20 );
		if ( $settings['canonical'] ) {
			remove_action( 'wp_head', 'rel_canonical' );
		}
		if ( ! $settings['sitemap'] ) {
			add_filter( 'wp_sitemaps_enabled', '__return_false' );
		}
	}

	public static function filter_separator( $sep ) {
		$settings = self::settings();
		return $settings['separator'];
	}

	/** The page title from the post's override or the template. */
	public static function filter_title( $title ) {
		$page = self::page();
		return '' !== $page['title'] ? $page['title'] : $title;
	}

	public static function print_head() {
		$settings = self::settings();
		echo self::head_html( $settings, self::page() ); // phpcs:ignore WordPress.Security.EscapeOutput
	}

	/** Robots directives: noindex for the pages the settings and per-page overrides ask for. */
	public static function filter_robots( $robots ) {
		$settings = self::settings();
		$page     = self::page();
		if ( $page['noindex'] || ( is_search() && $settings['noindex_search'] ) || ( is_author() && $settings['noindex_author'] ) || ( is_date() && $settings['noindex_date'] ) ) {
			$robots['noindex'] = true;
			$robots['follow']  = true;
			unset( $robots['index'] );
		}
		return $robots;
	}

	private static $page_cache = null;

	/** What the current request's head should say. Computed once per request. */
	private static function page() {
		if ( null !== self::$page_cache ) {
			return self::$page_cache;
		}
		$settings  = self::settings();
		$site_name = html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' );
		$tagline   = html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' );
		$vars      = array(
			'sitename' => $site_name,
			'tagline'  => $tagline,
			'sep'      => $settings['separator'],
		);
		$page      = array(
			'kind'        => 'other',
			'title'       => '',
			'description' => '',
			'url'         => '',
			'image'       => $settings['og_image'],
			'type'        => 'website',
			'noindex'     => false,
			'site_name'   => $site_name,
			'tagline'     => $tagline,
			'locale'      => str_replace( '-', '_', get_locale() ),
		);

		if ( is_front_page() || is_home() ) {
			$page['kind'] = 'home';
			$home_title   = '' !== $settings['home_title'] ? $settings['home_title'] : $site_name . ( '' !== $tagline ? ' ' . $settings['separator'] . ' ' . $tagline : '' );
			// A static front page can carry its own overrides.
			$post_id = (int) get_queried_object_id();
			if ( is_singular() && $post_id ) {
				self::apply_post( $page, $settings, $vars, $post_id );
			} else {
				$page['title']       = self::fill_template( $home_title, $vars );
				$page['description'] = '' !== $settings['home_description'] ? $settings['home_description'] : $tagline;
			}
			$page['url'] = home_url( '/' );
		} elseif ( is_singular() ) {
			$page['kind'] = 'singular';
			self::apply_post( $page, $settings, $vars, (int) get_queried_object_id() );
		} elseif ( is_category() || is_tag() || is_tax() ) {
			$page['kind']  = 'term';
			$term          = get_queried_object();
			$vars['title'] = $term ? html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' ) : '';
			$page['title'] = self::fill_template( $settings['title_template'], $vars );
			if ( $term && ! empty( $term->description ) ) {
				$page['description'] = self::trim_description( $term->description );
			}
			$link = $term ? get_term_link( $term ) : '';
			$page['url'] = is_string( $link ) ? $link : '';
		}

		self::$page_cache = $page;
		return $page;
	}

	/** Fill a page's fields from a post: overrides first, then the template and an excerpt. */
	private static function apply_post( &$page, $settings, $vars, $post_id ) {
		$post = $post_id ? get_post( $post_id ) : null;
		if ( ! $post ) {
			return;
		}
		$custom_title = (string) get_post_meta( $post_id, self::META_TITLE, true );
		$custom_desc  = (string) get_post_meta( $post_id, self::META_DESCRIPTION, true );
		$vars['title'] = html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' );
		$page['title'] = self::fill_template( '' !== $custom_title ? $custom_title : $settings['title_template'], $vars );
		if ( '' !== $custom_desc ) {
			$page['description'] = $custom_desc;
		} else {
			$source              = '' !== trim( (string) $post->post_excerpt ) ? $post->post_excerpt : $post->post_content;
			$page['description'] = self::trim_description( $source );
		}
		$page['url']     = (string) get_permalink( $post );
		$page['type']    = 'post' === $post->post_type ? 'article' : 'website';
		$page['noindex'] = (bool) get_post_meta( $post_id, self::META_NOINDEX, true );
		$image           = (string) get_post_meta( $post_id, self::META_IMAGE, true );
		if ( '' === $image ) {
			$thumb = get_the_post_thumbnail_url( $post, 'large' );
			$image = $thumb ? $thumb : '';
		}
		if ( '' !== $image ) {
			$page['image'] = $image;
		}
	}

	/* ---- Dashboard routes ---- */

	/** The settings, whether another SEO plugin is in the way, and the site's identity for previews. */
	public static function report() {
		return array(
			'settings'  => self::settings(),
			'conflict'  => self::conflict(),
			'site_name' => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
			'tagline'   => html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' ),
			'home_url'  => home_url( '/' ),
			// WordPress's own "Discourage search engines" switch; when set, every page is noindex whatever is said here.
			'discouraged' => '0' === (string) get_option( 'blog_public', '1' ),
		);
	}

	public static function save_settings( $request ) {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$new  = self::clean( $body );
		update_option( self::OPTION, $new, true );
		return self::report();
	}

	/** Published posts, pages and public custom types with their overrides, 20 at a time. */
	public static function pages( $request ) {
		$types = array_keys( get_post_types( array( 'public' => true ) ) );
		$types = array_values( array_diff( $types, array( 'attachment' ) ) );
		$query = new WP_Query(
			array(
				'post_type'           => $types,
				'post_status'         => 'publish',
				's'                   => (string) $request->get_param( 'search' ),
				'posts_per_page'      => 20,
				'paged'               => (int) $request->get_param( 'page' ),
				'orderby'             => 'date',
				'order'               => 'DESC',
				'ignore_sticky_posts' => true,
			)
		);
		$items = array();
		foreach ( $query->posts as $post ) {
			$items[] = array(
				'id'          => (int) $post->ID,
				'title'       => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
				'type'        => $post->post_type,
				'permalink'   => (string) get_permalink( $post ),
				'seo_title'   => (string) get_post_meta( $post->ID, self::META_TITLE, true ),
				'description' => (string) get_post_meta( $post->ID, self::META_DESCRIPTION, true ),
				'noindex'     => (bool) get_post_meta( $post->ID, self::META_NOINDEX, true ),
				'image'       => (string) get_post_meta( $post->ID, self::META_IMAGE, true ),
				'excerpt'     => self::trim_description( '' !== trim( (string) $post->post_excerpt ) ? $post->post_excerpt : $post->post_content ),
			);
		}
		return array(
			'items' => $items,
			'total' => (int) $query->found_posts,
		);
	}

	/** Save one page's overrides; an empty value removes the override. */
	public static function save_page( $request ) {
		$id   = (int) $request->get_param( 'id' );
		$post = get_post( $id );
		if ( ! $post ) {
			return new WP_Error( 'kontrolwp_not_found', 'That page no longer exists.', array( 'status' => 404 ) );
		}
		$set = function ( $key, $value ) use ( $id ) {
			if ( '' === $value || false === $value ) {
				delete_post_meta( $id, $key );
			} else {
				update_post_meta( $id, $key, $value );
			}
		};
		if ( null !== $request->get_param( 'seo_title' ) ) {
			$set( self::META_TITLE, self::line( (string) $request->get_param( 'seo_title' ), 200 ) );
		}
		if ( null !== $request->get_param( 'description' ) ) {
			$set( self::META_DESCRIPTION, self::line( (string) $request->get_param( 'description' ), 320 ) );
		}
		if ( null !== $request->get_param( 'noindex' ) ) {
			$set( self::META_NOINDEX, $request->get_param( 'noindex' ) ? '1' : '' );
		}
		if ( null !== $request->get_param( 'image' ) ) {
			$set( self::META_IMAGE, self::url( (string) $request->get_param( 'image' ) ) );
		}
		return array(
			'id'          => $id,
			'seo_title'   => (string) get_post_meta( $id, self::META_TITLE, true ),
			'description' => (string) get_post_meta( $id, self::META_DESCRIPTION, true ),
			'noindex'     => (bool) get_post_meta( $id, self::META_NOINDEX, true ),
			'image'       => (string) get_post_meta( $id, self::META_IMAGE, true ),
		);
	}
}
