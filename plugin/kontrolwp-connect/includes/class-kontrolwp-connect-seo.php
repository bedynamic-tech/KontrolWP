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

	/** Schema.org types the business can be marked up as. */
	const BUSINESS_TYPES = array(
		'LocalBusiness',
		'Restaurant',
		'CafeOrCoffeeShop',
		'Store',
		'ProfessionalService',
		'LegalService',
		'AccountingService',
		'FinancialService',
		'Dentist',
		'Physician',
		'HealthAndBeautyBusiness',
		'RealEstateAgent',
		'HomeAndConstructionBusiness',
		'AutomotiveBusiness',
		'LodgingBusiness',
		'SportsActivityLocation',
		'EntertainmentBusiness',
	);

	/** Days in the order the dashboard lists them, with schema.org's names for them. */
	const DAYS = array(
		'mon' => 'Monday',
		'tue' => 'Tuesday',
		'wed' => 'Wednesday',
		'thu' => 'Thursday',
		'fri' => 'Friday',
		'sat' => 'Saturday',
		'sun' => 'Sunday',
	);

	/** Most locations one site can list. */
	const MAX_LOCATIONS = 50;

	const LOCATION_DEFAULTS = array(
		'id'          => '',
		// A page that stands for this location; its markup goes there instead of on the home page. 0 for none.
		'page_id'     => 0,
		'type'        => 'LocalBusiness',
		'name'        => '',
		'phone'       => '',
		'email'       => '',
		'logo'        => '',
		'image'       => '',
		'street'      => '',
		'city'        => '',
		'region'      => '',
		'postal'      => '',
		'country'     => '',
		'latitude'    => '',
		'longitude'   => '',
		'price_range' => '',
		'hours'       => array(),
		'same_as'     => array(),
	);

	const LOCAL_DEFAULTS = array(
		'enabled'   => false,
		'locations' => array(),
	);

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
		'noindex_attachment' => true,
		'noindex_author_single' => true,
		'hidden_taxonomies'  => array( 'post_tag' ),
		'hidden_types'       => array(),
		'canonical'          => true,
		'sitemap'            => true,
		'local'              => self::LOCAL_DEFAULTS,
		'strip_category_base' => false,
		'author_archives'    => 'keep',
		'type_templates'     => array(),
	);

	/**
	 * What a setting added after 0.15.0 means for a site that saved its
	 * settings before it existed: what the plugin did then, so an update never
	 * changes a live site's pages. Sites that never saved get the defaults.
	 */
	const UNCHANGED_FOR_EXISTING = array(
		'noindex_attachment'    => false,
		'noindex_author_single' => false,
		'hidden_taxonomies'     => array(),
		'hidden_types'          => array(),
	);

	/** The tagline WordPress installs with, which says nothing about the site. */
	const DEFAULT_TAGLINE = 'Just another WordPress site';

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
		$saved = get_option( self::OPTION, false );
		if ( ! is_array( $saved ) ) {
			return self::clean( array() );
		}
		foreach ( self::UNCHANGED_FOR_EXISTING as $key => $value ) {
			if ( ! array_key_exists( $key, $saved ) ) {
				$saved[ $key ] = $value;
			}
		}
		return self::clean( $saved );
	}

	/** A settings array with only known keys, each of the right type. Pure; used on input and on what is stored. */
	public static function clean( $input ) {
		$out = self::DEFAULTS;
		foreach ( array( 'enabled', 'og_enabled', 'noindex_search', 'noindex_author', 'noindex_date', 'noindex_attachment', 'noindex_author_single', 'canonical', 'sitemap' ) as $key ) {
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
		foreach ( array( 'hidden_taxonomies', 'hidden_types' ) as $key ) {
			if ( isset( $input[ $key ] ) && is_array( $input[ $key ] ) ) {
				$names = array();
				foreach ( array_slice( $input[ $key ], 0, 50 ) as $name ) {
					if ( is_string( $name ) && preg_match( '/^[a-z0-9_-]{1,32}$/', $name ) ) {
						$names[] = $name;
					}
				}
				$out[ $key ] = array_values( array_unique( $names ) );
			}
		}
		if ( isset( $input['strip_category_base'] ) ) {
			$out['strip_category_base'] = (bool) $input['strip_category_base'];
		}
		if ( isset( $input['author_archives'] ) && in_array( $input['author_archives'], array( 'keep', 'redirect', '404' ), true ) ) {
			$out['author_archives'] = $input['author_archives'];
		}
		if ( isset( $input['type_templates'] ) && is_array( $input['type_templates'] ) ) {
			$out['type_templates'] = self::clean_type_templates( $input['type_templates'] );
		}
		$out['local'] = self::clean_local( isset( $input['local'] ) && is_array( $input['local'] ) ? $input['local'] : array() );
		return $out;
	}

	/** Title and description templates by content type: only valid type names, only filled-in templates, at most 50 types. Pure. */
	public static function clean_type_templates( $input ) {
		$out = array();
		foreach ( array_slice( $input, 0, 50, true ) as $name => $item ) {
			if ( ! is_string( $name ) || ! preg_match( '/^[a-z0-9_-]{1,32}$/', $name ) || ! is_array( $item ) ) {
				continue;
			}
			$title       = isset( $item['title'] ) && is_string( $item['title'] ) ? self::line( $item['title'], 200 ) : '';
			$description = isset( $item['description'] ) && is_string( $item['description'] ) ? self::line( $item['description'], 320 ) : '';
			if ( '' !== $title || '' !== $description ) {
				$out[ $name ] = array(
					'title'       => $title,
					'description' => $description,
				);
			}
		}
		return $out;
	}

	/** The title template for a content type: its own when it has one, else the site-wide one. Pure. */
	public static function title_template_for( $settings, $post_type ) {
		$own = isset( $settings['type_templates'][ $post_type ]['title'] ) ? $settings['type_templates'][ $post_type ]['title'] : '';
		return '' !== $own ? $own : $settings['title_template'];
	}

	/** The description template for a content type, or an empty string when the description comes from the excerpt. Pure. */
	public static function description_template_for( $settings, $post_type ) {
		return isset( $settings['type_templates'][ $post_type ]['description'] ) ? $settings['type_templates'][ $post_type ]['description'] : '';
	}

	/** The business settings: on or off, and a list of locations. Pure. Settings saved before locations existed held one business and become one location. */
	public static function clean_local( $input ) {
		$out = self::LOCAL_DEFAULTS;
		if ( array_key_exists( 'enabled', $input ) ) {
			$out['enabled'] = (bool) $input['enabled'];
		}
		$list = array();
		if ( isset( $input['locations'] ) && is_array( $input['locations'] ) ) {
			$list = $input['locations'];
		} elseif ( isset( $input['name'] ) || isset( $input['phone'] ) || isset( $input['street'] ) ) {
			$list = array( $input );
		}
		$seen = array();
		foreach ( array_slice( array_values( $list ), 0, self::MAX_LOCATIONS ) as $index => $item ) {
			if ( ! is_array( $item ) ) {
				continue;
			}
			$location = self::clean_location( $item );
			if ( '' === $location['id'] || isset( $seen[ $location['id'] ] ) ) {
				$location['id'] = 'loc' . ( $index + 1 );
			}
			$seen[ $location['id'] ] = true;
			$out['locations'][]      = $location;
		}
		return $out;
	}

	/** One location with only known keys, each of the right type. Pure. */
	public static function clean_location( $input ) {
		$out = self::LOCATION_DEFAULTS;
		if ( isset( $input['id'] ) && is_string( $input['id'] ) && preg_match( '/^[a-z0-9]{4,16}$/', $input['id'] ) ) {
			$out['id'] = $input['id'];
		}
		if ( isset( $input['page_id'] ) && is_numeric( $input['page_id'] ) && (int) $input['page_id'] > 0 ) {
			$out['page_id'] = (int) $input['page_id'];
		}
		if ( isset( $input['type'] ) && in_array( $input['type'], self::BUSINESS_TYPES, true ) ) {
			$out['type'] = $input['type'];
		}
		foreach ( array( 'name', 'phone', 'email', 'street', 'city', 'region', 'postal', 'country', 'price_range' ) as $key ) {
			if ( isset( $input[ $key ] ) && is_string( $input[ $key ] ) ) {
				$out[ $key ] = self::line( $input[ $key ], 200 );
			}
		}
		foreach ( array( 'logo', 'image' ) as $key ) {
			if ( isset( $input[ $key ] ) && is_string( $input[ $key ] ) ) {
				$out[ $key ] = self::url( $input[ $key ] );
			}
		}
		// Coordinates: a number inside the range, or empty.
		foreach ( array( 'latitude' => 90, 'longitude' => 180 ) as $key => $limit ) {
			if ( isset( $input[ $key ] ) && ( is_string( $input[ $key ] ) || is_numeric( $input[ $key ] ) ) ) {
				$value = trim( (string) $input[ $key ] );
				if ( is_numeric( $value ) && abs( (float) $value ) <= $limit ) {
					$out[ $key ] = (string) ( (float) $value );
				}
			}
		}
		if ( isset( $input['hours'] ) && is_array( $input['hours'] ) ) {
			foreach ( array_keys( self::DAYS ) as $day ) {
				$hours = isset( $input['hours'][ $day ] ) && is_array( $input['hours'][ $day ] ) ? $input['hours'][ $day ] : array();
				$open  = isset( $hours['open'] ) && is_string( $hours['open'] ) ? trim( $hours['open'] ) : '';
				$close = isset( $hours['close'] ) && is_string( $hours['close'] ) ? trim( $hours['close'] ) : '';
				$valid = '/^([01]\d|2[0-3]):[0-5]\d$/';
				if ( preg_match( $valid, $open ) && preg_match( $valid, $close ) ) {
					$out['hours'][ $day ] = array(
						'open'  => $open,
						'close' => $close,
					);
				}
			}
		}
		if ( isset( $input['same_as'] ) && is_array( $input['same_as'] ) ) {
			foreach ( $input['same_as'] as $link ) {
				$link = is_string( $link ) ? self::url( $link ) : '';
				if ( '' !== $link && ! in_array( $link, $out['same_as'], true ) && count( $out['same_as'] ) < 10 ) {
					$out['same_as'][] = $link;
				}
			}
		}
		return $out;
	}

	/**
	 * The schema.org markup for the business, or null when there is too little
	 * to describe it (a name and either a phone number or a street address).
	 * Pure; $site_name and $home_url come from WordPress.
	 */
	public static function business_schema( $local, $site_name, $home_url ) {
		$name = '' !== $local['name'] ? $local['name'] : $site_name;
		if ( '' === $name || ( '' === $local['phone'] && '' === $local['street'] ) ) {
			return null;
		}
		$schema = array(
			'@context' => 'https://schema.org',
			'@type'    => $local['type'],
			'name'     => $name,
			'url'      => $home_url,
		);
		foreach ( array(
			'telephone'  => 'phone',
			'email'      => 'email',
			'image'      => 'image',
			'priceRange' => 'price_range',
		) as $property => $key ) {
			if ( '' !== $local[ $key ] ) {
				$schema[ $property ] = $local[ $key ];
			}
		}
		if ( '' !== $local['logo'] ) {
			$schema['logo'] = $local['logo'];
		}
		$address = array();
		foreach ( array(
			'streetAddress'   => 'street',
			'addressLocality' => 'city',
			'addressRegion'   => 'region',
			'postalCode'      => 'postal',
			'addressCountry'  => 'country',
		) as $property => $key ) {
			if ( '' !== $local[ $key ] ) {
				$address[ $property ] = $local[ $key ];
			}
		}
		if ( $address ) {
			$schema['address'] = array_merge( array( '@type' => 'PostalAddress' ), $address );
		}
		if ( '' !== $local['latitude'] && '' !== $local['longitude'] ) {
			$schema['geo'] = array(
				'@type'     => 'GeoCoordinates',
				'latitude'  => (float) $local['latitude'],
				'longitude' => (float) $local['longitude'],
			);
		}
		$hours = array();
		foreach ( self::DAYS as $key => $day ) {
			if ( isset( $local['hours'][ $key ] ) ) {
				$hours[] = array(
					'@type'     => 'OpeningHoursSpecification',
					'dayOfWeek' => $day,
					'opens'     => $local['hours'][ $key ]['open'],
					'closes'    => $local['hours'][ $key ]['close'],
				);
			}
		}
		if ( $hours ) {
			$schema['openingHoursSpecification'] = $hours;
		}
		if ( $local['same_as'] ) {
			$schema['sameAs'] = $local['same_as'];
		}
		return $schema;
	}

	/**
	 * The markup one page carries: locations with no page of their own go on
	 * the home page, and a location with a page goes on that page. One block,
	 * or a @graph when several apply. Null when none do.
	 */
	public static function schemas_for( $local, $page ) {
		$is_home = 'home' === $page['kind'];
		$post_id = isset( $page['post_id'] ) ? (int) $page['post_id'] : 0;
		$home    = isset( $page['home_url'] ) ? $page['home_url'] : $page['url'];
		$found   = array();
		foreach ( $local['locations'] as $location ) {
			$own = (int) $location['page_id'];
			if ( ( 0 === $own && $is_home ) || ( $own > 0 && $own === $post_id ) ) {
				$url    = $own > 0 ? $page['url'] : $home;
				$schema = self::business_schema( $location, $page['site_name'], $url );
				if ( $schema ) {
					$schema['@id'] = $url . '#' . $location['id'];
					$found[]       = $schema;
				}
			}
		}
		if ( ! $found ) {
			return null;
		}
		if ( 1 === count( $found ) ) {
			return $found[0];
		}
		foreach ( $found as $index => $schema ) {
			unset( $found[ $index ]['@context'] );
		}
		return array(
			'@context' => 'https://schema.org',
			'@graph'   => $found,
		);
	}

	/** Plain text on one line, cut to a length. */
	public static function line( $text, $max ) {
		$text = wp_strip_all_tags( $text );
		$text = trim( preg_replace( '/\s+/u', ' ', $text ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max ) : substr( $text, 0, $max );
	}

	/** An http or https address, or an empty string. */
	public static function url( $value ) {
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
			'/%(title|sitename|tagline|sep|excerpt)%/',
			function ( $m ) use ( $vars ) {
				return isset( $vars[ $m[1] ] ) ? $vars[ $m[1] ] : '';
			},
			$template
		);
		$out = preg_replace( '/\s+/u', ' ', $out );
		return trim( $out );
	}

	/** The site's tagline, or an empty string when it is still WordPress's placeholder. */
	public static function usable_tagline( $tagline, $placeholders = array( self::DEFAULT_TAGLINE ) ) {
		$tagline = trim( (string) $tagline );
		return in_array( $tagline, $placeholders, true ) ? '' : $tagline;
	}

	/** A title for page two and later of a list, so no two pages share a title. */
	public static function with_page_number( $title, $sep, $number, $label ) {
		return $number > 1 ? trim( $title . ' ' . $sep . ' ' . sprintf( $label, $number ) ) : $title;
	}

	/**
	 * Whether a page asks search engines not to list it. $ctx keys: search,
	 * author, date, attachment, taxonomy (the term page's taxonomy or ''),
	 * post_type (the singular page's type or ''), single_author, flagged (the
	 * page's own override).
	 */
	public static function wants_noindex( $settings, $ctx ) {
		return ! empty( $ctx['flagged'] )
			|| ( ! empty( $ctx['search'] ) && $settings['noindex_search'] )
			|| ( ! empty( $ctx['author'] ) && ( $settings['noindex_author'] || ( $settings['noindex_author_single'] && ! empty( $ctx['single_author'] ) ) ) )
			|| ( ! empty( $ctx['date'] ) && $settings['noindex_date'] )
			|| ( ! empty( $ctx['attachment'] ) && $settings['noindex_attachment'] )
			|| ( ! empty( $ctx['taxonomy'] ) && in_array( $ctx['taxonomy'], $settings['hidden_taxonomies'], true ) )
			|| ( ! empty( $ctx['post_type'] ) && in_array( $ctx['post_type'], $settings['hidden_types'], true ) );
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
		if ( ! empty( $settings['local']['enabled'] ) ) {
			$schema = self::schemas_for( $settings['local'], $page );
			if ( $schema ) {
				$tags[] = '<script type="application/ld+json">'
					. wp_json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP )
					. '</script>';
			}
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
		} else {
			add_filter( 'wp_sitemaps_post_types', array( __CLASS__, 'sitemap_post_types' ) );
			add_filter( 'wp_sitemaps_taxonomies', array( __CLASS__, 'sitemap_taxonomies' ) );
			add_filter( 'wp_sitemaps_posts_query_args', array( __CLASS__, 'sitemap_posts_query' ) );
			add_filter( 'wp_sitemaps_add_provider', array( __CLASS__, 'sitemap_provider' ), 10, 2 );
		}
	}

	/* The sitemap lists what search engines are asked to list: nothing hidden, so the two never disagree. */

	public static function sitemap_post_types( $types ) {
		$settings = self::settings();
		return array_diff_key( $types, array_flip( $settings['hidden_types'] ) );
	}

	public static function sitemap_taxonomies( $taxonomies ) {
		$settings = self::settings();
		return array_diff_key( $taxonomies, array_flip( $settings['hidden_taxonomies'] ) );
	}

	public static function sitemap_posts_query( $args ) {
		$clause = array(
			'relation' => 'OR',
			array(
				'key'     => self::META_NOINDEX,
				'compare' => 'NOT EXISTS',
			),
			array(
				'key'     => self::META_NOINDEX,
				'value'   => '1',
				'compare' => '!=',
			),
		);
		$args['meta_query'] = isset( $args['meta_query'] ) && is_array( $args['meta_query'] ) ? array( 'relation' => 'AND', $args['meta_query'], $clause ) : array( $clause );
		return $args;
	}

	/** The people sitemap goes when author pages are hidden, which includes a site with one author. */
	public static function sitemap_provider( $provider, $name ) {
		if ( 'users' !== $name ) {
			return $provider;
		}
		$settings = self::settings();
		$hidden   = 'keep' !== $settings['author_archives'] || $settings['noindex_author'] || ( $settings['noindex_author_single'] && self::single_author() );
		return $hidden ? false : $provider;
	}

	public static function filter_separator( $sep ) {
		$settings = self::settings();
		return $settings['separator'];
	}

	/** The page title from the post's override or the template. */
	public static function filter_title( $title ) {
		$page = self::page();
		if ( '' === $page['title'] ) {
			return $title;
		}
		$settings = self::settings();
		$number   = max( (int) get_query_var( 'paged' ), (int) get_query_var( 'page' ) );
		return self::with_page_number( $page['title'], $settings['separator'], $number, __( 'Page %s' ) ); // phpcs:ignore WordPress.WP.I18n

	}

	public static function print_head() {
		$settings = self::settings();
		echo self::head_html( $settings, self::page() ); // phpcs:ignore WordPress.Security.EscapeOutput
	}

	/** The tagline as the pages use it: decoded, and empty while it is still WordPress's placeholder. */
	private static function site_tagline() {
		return self::usable_tagline(
			html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' ),
			array( self::DEFAULT_TAGLINE, __( 'Just another WordPress site' ) ) // phpcs:ignore WordPress.WP.I18n
		);
	}

	/** Whether the site has fewer than two people with published posts, so an author page repeats the blog. */
	private static function single_author() {
		static $single = null;
		if ( null === $single ) {
			$single = count( get_users( array( 'has_published_posts' => true, 'fields' => 'ID', 'number' => 2 ) ) ) < 2;
		}
		return $single;
	}

	/** Robots directives: noindex for the pages the settings and per-page overrides ask for. */
	public static function filter_robots( $robots ) {
		$settings = self::settings();
		$page     = self::page();
		$object   = get_queried_object();
		$ctx      = array(
			'flagged'    => $page['noindex'],
			'search'     => is_search(),
			'author'     => is_author(),
			'date'       => is_date(),
			'attachment' => is_attachment(),
			'taxonomy'   => ( is_category() || is_tag() || is_tax() ) && $object && isset( $object->taxonomy ) ? $object->taxonomy : '',
			'post_type'  => is_singular() && $object && isset( $object->post_type ) ? $object->post_type : '',
		);
		if ( is_author() ) {
			$ctx['single_author'] = self::single_author();
		}
		if ( self::wants_noindex( $settings, $ctx ) ) {
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
		$tagline   = self::site_tagline();
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
			'image'       => '' !== $settings['og_image'] ? $settings['og_image'] : (string) get_site_icon_url( 512 ),
			'type'        => 'website',
			'noindex'     => false,
			'site_name'   => $site_name,
			'tagline'     => $tagline,
			'locale'      => str_replace( '-', '_', get_locale() ),
			'post_id'     => 0,
			'home_url'    => home_url( '/' ),
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

		// Page two and later of a list is its own page, so it is its own canonical address.
		$paged = (int) get_query_var( 'paged' );
		if ( $paged > 1 && in_array( $page['kind'], array( 'home', 'term' ), true ) && '' !== $page['url'] ) {
			$page['url'] = get_pagenum_link( $paged, false );
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
		$source        = '' !== trim( (string) $post->post_excerpt ) ? $post->post_excerpt : $post->post_content;
		$excerpt       = self::trim_description( $source );
		$vars['title']   = html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' );
		$vars['excerpt'] = $excerpt;
		$page['title'] = self::fill_template( '' !== $custom_title ? $custom_title : self::title_template_for( $settings, $post->post_type ), $vars );
		$desc_template = self::description_template_for( $settings, $post->post_type );
		if ( '' !== $custom_desc ) {
			$page['description'] = $custom_desc;
		} elseif ( '' !== $desc_template && '' !== self::fill_template( $desc_template, $vars ) ) {
			$page['description'] = self::trim_description( self::fill_template( $desc_template, $vars ) );
		} else {
			$page['description'] = $excerpt;
		}
		$page['post_id'] = $post_id;
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
			'tagline'   => self::site_tagline(),
			'home_url'  => home_url( '/' ),
			// WordPress's own "Discourage search engines" switch; when set, every page is noindex whatever is said here.
			'discouraged' => '0' === (string) get_option( 'blog_public', '1' ),
			'location_pages' => self::location_pages(),
			'category'       => KontrolWP_Connect_SEO_Archives::category_report(),
			'post_types'     => self::public_names( get_post_types( array( 'public' => true ), 'objects' ), array( 'attachment' ) ),
			'taxonomies'     => self::public_names( get_taxonomies( array( 'public' => true ), 'objects' ), array( 'post_format' ) ),
		);
	}

	/** Names and labels of public types or taxonomies, for the dashboard's checkboxes. */
	private static function public_names( $objects, $skip ) {
		$out = array();
		foreach ( $objects as $name => $object ) {
			if ( ! in_array( $name, $skip, true ) ) {
				$out[] = array(
					'name'  => $name,
					'label' => isset( $object->labels->name ) ? (string) $object->labels->name : $name,
				);
			}
		}
		return $out;
	}

	/** The title and address of each page a location is tied to, by page id; pages that no longer exist are left out. */
	private static function location_pages() {
		$settings = self::settings();
		$pages    = array();
		foreach ( $settings['local']['locations'] as $location ) {
			$id   = (int) $location['page_id'];
			$post = $id > 0 ? get_post( $id ) : null;
			if ( $post && 'publish' === $post->post_status ) {
				$pages[ (string) $id ] = array(
					'title' => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
					'url'   => (string) get_permalink( $post ),
				);
			}
		}
		return (object) $pages;
	}

	public static function save_settings( $request ) {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$new  = self::clean( $body );
		$old  = self::settings();
		update_option( self::OPTION, $new, true );
		// The category rewrite rules are stored, so a change to them is rebuilt now rather than at the next edit.
		if ( $old['strip_category_base'] !== $new['strip_category_base'] || $old['enabled'] !== $new['enabled'] ) {
			KontrolWP_Connect_SEO_Archives::flush();
		}
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
				'keyword'     => (string) get_post_meta( $post->ID, KontrolWP_Connect_SEO_Score::META_KEYWORD, true ),
				'score'       => KontrolWP_Connect_SEO_Score::for_post( $post )['status'],
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
		if ( null !== $request->get_param( 'keyword' ) ) {
			$set( KontrolWP_Connect_SEO_Score::META_KEYWORD, KontrolWP_Connect_SEO_Score::clean_keyword( (string) $request->get_param( 'keyword' ) ) );
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
