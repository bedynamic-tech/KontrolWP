<?php
/**
 * The files and codes search engines and AI tools look for (0.20.0): site
 * verification tags, a robots.txt editor, llms.txt, and IndexNow.
 *
 * Nothing is written to disk. robots.txt, llms.txt and the IndexNow key file
 * are answered by WordPress itself, so removing the plugin removes them. When
 * another SEO plugin is active this class does nothing, so two plugins never
 * answer for the same file.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_SEO_Tools {

	/** Small settings, read on every request. */
	const OPTION = 'kontrolwp_connect_seo_tools';
	/** The two texts, read only when their file is asked for. */
	const TEXTS_OPTION = 'kontrolwp_connect_seo_tools_texts';

	const MAX_ROBOTS = 5000;
	const MAX_LLMS   = 20000;

	/** Verification tags: setting key => meta name. */
	const VERIFY = array(
		'google'    => 'google-site-verification',
		'bing'      => 'msvalidate.01',
		'yandex'    => 'yandex-verification',
		'baidu'     => 'baidu-site-verification',
		'pinterest' => 'p:domain_verify',
	);

	const DEFAULTS = array(
		'verify'      => array(
			'google'    => '',
			'bing'      => '',
			'yandex'    => '',
			'baidu'     => '',
			'pinterest' => '',
		),
		'robots_mode' => 'default',
		'llms_mode'   => 'off',
		'indexnow'    => false,
		'indexnow_key' => '',
	);

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/seo/tools'      => 'report_route',
			'/seo/tools/save' => 'save_route',
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

	/** A verification code from what was pasted: the code itself, or a whole meta tag it sits in. */
	public static function clean_code( $value ) {
		$value = trim( (string) $value );
		if ( preg_match( '/content\s*=\s*["\']([^"\']+)["\']/i', $value, $m ) ) {
			$value = $m[1];
		}
		return preg_match( '/^[A-Za-z0-9_\-.=]{1,200}$/', $value ) ? $value : '';
	}

	/** Settings from untrusted input: only known keys of the right shape. */
	public static function clean( $input ) {
		$out = self::DEFAULTS;
		if ( isset( $input['verify'] ) && is_array( $input['verify'] ) ) {
			foreach ( array_keys( self::VERIFY ) as $key ) {
				if ( isset( $input['verify'][ $key ] ) ) {
					$out['verify'][ $key ] = self::clean_code( $input['verify'][ $key ] );
				}
			}
		}
		if ( isset( $input['robots_mode'] ) && in_array( $input['robots_mode'], array( 'default', 'custom' ), true ) ) {
			$out['robots_mode'] = $input['robots_mode'];
		}
		if ( isset( $input['llms_mode'] ) && in_array( $input['llms_mode'], array( 'off', 'auto', 'custom' ), true ) ) {
			$out['llms_mode'] = $input['llms_mode'];
		}
		$out['indexnow'] = ! empty( $input['indexnow'] );
		if ( isset( $input['indexnow_key'] ) && is_string( $input['indexnow_key'] ) && preg_match( '/^[A-Za-z0-9]{16,64}$/', $input['indexnow_key'] ) ) {
			$out['indexnow_key'] = $input['indexnow_key'];
		}
		return $out;
	}

	/**
	 * Whether robots.txt text is acceptable. Returns an error message, or an
	 * empty string. Only robots directives and comments are allowed, and a rule
	 * that asks every crawler to skip the whole site is refused, since a stray
	 * line there removes a site from search.
	 */
	public static function robots_error( $text ) {
		$text = (string) $text;
		if ( strlen( $text ) > self::MAX_ROBOTS ) {
			return 'robots.txt can be up to ' . self::MAX_ROBOTS . ' characters.';
		}
		$agents  = array();
		$in_rule = false;
		foreach ( preg_split( '/\r\n|\r|\n/', $text ) as $number => $line ) {
			$line = trim( $line );
			if ( '' === $line || '#' === $line[0] ) {
				continue;
			}
			if ( ! preg_match( '/^(user-agent|allow|disallow|sitemap|crawl-delay|host)\s*:\s*(.*)$/i', $line, $m ) || preg_match( '/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $line ) ) {
				return 'Line ' . ( $number + 1 ) . ' is not a robots.txt rule.';
			}
			$field = strtolower( $m[1] );
			$value = trim( $m[2] );
			if ( 'user-agent' === $field ) {
				if ( $in_rule ) {
					$agents  = array();
					$in_rule = false;
				}
				$agents[] = strtolower( $value );
			} elseif ( 'disallow' === $field ) {
				$in_rule = true;
				if ( '/' === $value && in_array( '*', $agents, true ) ) {
					return 'That would ask every search engine to skip the whole site.';
				}
			} elseif ( 'allow' === $field || 'crawl-delay' === $field ) {
				$in_rule = true;
			}
		}
		return '';
	}

	/** What /robots.txt should say. A site that discourages search engines keeps WordPress's own answer. */
	public static function robots_output( $mode, $custom, $default, $public ) {
		if ( 'custom' !== $mode || ! $public || '' === trim( (string) $custom ) ) {
			return $default;
		}
		return rtrim( str_replace( array( "\r\n", "\r" ), "\n", (string) $custom ) ) . "\n";
	}

	/**
	 * The llms.txt text made from the site's identity and its pages.
	 * $pages and $posts are lists of array( title, url, excerpt ).
	 */
	public static function llms_auto( $site_name, $tagline, $pages, $posts ) {
		$out = '# ' . trim( preg_replace( '/\s+/', ' ', $site_name ) ) . "\n";
		if ( '' !== trim( $tagline ) ) {
			$out .= '> ' . trim( preg_replace( '/\s+/', ' ', $tagline ) ) . "\n";
		}
		$list = function ( $heading, $items ) {
			if ( ! $items ) {
				return '';
			}
			$text = "\n## " . $heading . "\n";
			foreach ( $items as $item ) {
				$title    = trim( preg_replace( '/[\[\]\s]+/', ' ', $item[0] ) );
				$excerpt  = trim( preg_replace( '/\s+/', ' ', $item[2] ) );
				$excerpt  = function_exists( 'mb_substr' ) ? mb_substr( $excerpt, 0, 120 ) : substr( $excerpt, 0, 120 );
				$text    .= '- [' . $title . '](' . $item[1] . ')' . ( '' !== $excerpt ? ': ' . $excerpt : '' ) . "\n";
			}
			return $text;
		};
		return $out . $list( 'Pages', $pages ) . $list( 'Recent posts', $posts );
	}

	/** The JSON an IndexNow submission carries. */
	public static function indexnow_payload( $host, $key, $key_url, $urls ) {
		return array(
			'host'        => $host,
			'key'         => $key,
			'keyLocation' => $key_url,
			'urlList'     => array_values( array_unique( $urls ) ),
		);
	}

	/* ---- Storage ---- */

	public static function settings() {
		$saved = get_option( self::OPTION, array() );
		return self::clean( is_array( $saved ) ? $saved : array() );
	}

	private static function texts() {
		$saved = get_option( self::TEXTS_OPTION, array() );
		$saved = is_array( $saved ) ? $saved : array();
		return array(
			'robots' => isset( $saved['robots'] ) ? (string) $saved['robots'] : '',
			'llms'   => isset( $saved['llms'] ) ? (string) $saved['llms'] : '',
		);
	}

	/* ---- Front end ---- */

	public static function boot() {
		if ( '' !== KontrolWP_Connect_SEO::conflict() ) {
			return;
		}
		$settings = self::settings();
		if ( array_filter( $settings['verify'] ) ) {
			add_action( 'wp_head', array( __CLASS__, 'print_verification' ), 2 );
		}
		if ( 'custom' === $settings['robots_mode'] ) {
			add_filter( 'robots_txt', array( __CLASS__, 'filter_robots_txt' ), 20, 2 );
		}
		if ( 'off' !== $settings['llms_mode'] || ( $settings['indexnow'] && '' !== $settings['indexnow_key'] ) ) {
			add_action( 'parse_request', array( __CLASS__, 'serve_files' ) );
			// A second chance before WordPress's own redirects, for requests that reach a template without passing parse_request first.
			add_action( 'template_redirect', array( __CLASS__, 'serve_files' ), 0 );
		}
		if ( $settings['indexnow'] && '' !== $settings['indexnow_key'] ) {
			add_action( 'transition_post_status', array( __CLASS__, 'indexnow_post' ), 20, 3 );
		}
	}

	/** Verification tags go on the home page, where search engines look for them. */
	public static function print_verification() {
		if ( ! is_front_page() && ! is_home() ) {
			return;
		}
		$settings = self::settings();
		$tags     = array();
		foreach ( self::VERIFY as $key => $name ) {
			if ( '' !== $settings['verify'][ $key ] ) {
				$tags[] = '<meta name="' . esc_attr( $name ) . '" content="' . esc_attr( $settings['verify'][ $key ] ) . '" />';
			}
		}
		if ( $tags ) {
			echo implode( "\n", $tags ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
		}
	}

	public static function filter_robots_txt( $output, $public ) {
		$texts = self::texts();
		return self::robots_output( 'custom', $texts['robots'], $output, (bool) $public );
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

	/** Answer /llms.txt and the IndexNow key file. */
	public static function serve_files() {
		$settings = self::settings();
		$path     = self::request_path();
		$body     = null;
		if ( '/llms.txt' === $path && 'off' !== $settings['llms_mode'] ) {
			$texts = self::texts();
			$body  = 'custom' === $settings['llms_mode'] && '' !== trim( $texts['llms'] ) ? $texts['llms'] : self::llms_text();
		} elseif ( $settings['indexnow'] && '' !== $settings['indexnow_key'] && '/' . $settings['indexnow_key'] . '.txt' === $path ) {
			$body = $settings['indexnow_key'];
		}
		if ( null === $body ) {
			return;
		}
		status_header( 200 );
		header( 'Content-Type: text/plain; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput
		exit;
	}

	/** The generated llms.txt, kept for an hour so a crawler's visits cost nothing. */
	private static function llms_text() {
		$cached = get_transient( 'kontrolwp_connect_llms' );
		if ( is_string( $cached ) ) {
			return $cached;
		}
		$text = self::llms_auto(
			html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
			KontrolWP_Connect_SEO::usable_tagline( html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' ) ),
			self::listing( 'page', 20, 'menu_order title', 'ASC' ),
			self::listing( 'post', 20, 'date', 'DESC' )
		);
		set_transient( 'kontrolwp_connect_llms', $text, HOUR_IN_SECONDS );
		return $text;
	}

	/** Published content of one type that is not marked hidden, as array( title, url, excerpt ). */
	private static function listing( $type, $count, $orderby, $order ) {
		$seo = KontrolWP_Connect_SEO::settings();
		if ( in_array( $type, $seo['hidden_types'], true ) ) {
			return array();
		}
		$posts = get_posts(
			array(
				'post_type'        => $type,
				'post_status'      => 'publish',
				'posts_per_page'   => $count,
				'orderby'          => $orderby,
				'order'            => $order,
				'suppress_filters' => true,
				'has_password'     => false,
				'meta_query'       => array(
					'relation' => 'OR',
					array(
						'key'     => KontrolWP_Connect_SEO::META_NOINDEX,
						'compare' => 'NOT EXISTS',
					),
					array(
						'key'     => KontrolWP_Connect_SEO::META_NOINDEX,
						'value'   => '1',
						'compare' => '!=',
					),
				),
			)
		);
		$out = array();
		foreach ( $posts as $post ) {
			$excerpt = '' !== trim( (string) $post->post_excerpt ) ? $post->post_excerpt : '';
			$out[]   = array(
				html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
				(string) get_permalink( $post ),
				wp_strip_all_tags( $excerpt ),
			);
		}
		return $out;
	}

	/** Tell search engines that join IndexNow when published content appears, changes or is removed. */
	public static function indexnow_post( $new_status, $old_status, $post ) {
		static $sent = array();
		$settings = self::settings();
		$public   = 'publish' === $new_status || ( 'publish' === $old_status && 'publish' !== $new_status );
		if ( ! $public || ! ( $post instanceof WP_Post ) || 'attachment' === $post->post_type || ! is_post_type_viewable( $post->post_type ) || '0' === (string) get_option( 'blog_public', '1' ) ) {
			return;
		}
		$seo = KontrolWP_Connect_SEO::settings();
		if ( in_array( $post->post_type, $seo['hidden_types'], true ) || ( 'publish' === $new_status && get_post_meta( $post->ID, KontrolWP_Connect_SEO::META_NOINDEX, true ) ) ) {
			return;
		}
		$url = get_permalink( $post );
		$host = wp_parse_url( home_url(), PHP_URL_HOST );
		if ( ! $url || ! $host || isset( $sent[ $post->ID ] ) || get_transient( 'kontrolwp_connect_indexnow_' . $post->ID ) ) {
			return;
		}
		$sent[ $post->ID ] = true;
		set_transient( 'kontrolwp_connect_indexnow_' . $post->ID, 1, MINUTE_IN_SECONDS );
		wp_remote_post(
			'https://api.indexnow.org/indexnow',
			array(
				'blocking' => false,
				'timeout'  => 3,
				'headers'  => array( 'Content-Type' => 'application/json; charset=utf-8' ),
				'body'     => wp_json_encode( self::indexnow_payload( $host, $settings['indexnow_key'], home_url( '/' . $settings['indexnow_key'] . '.txt' ), array( $url ) ) ),
			)
		);
	}

	/* ---- Dashboard routes ---- */

	public static function report() {
		$settings = self::settings();
		$texts    = self::texts();
		$default  = '';
		if ( function_exists( 'do_robots' ) ) {
			// WordPress's own answer, without the custom text.
			remove_filter( 'robots_txt', array( __CLASS__, 'filter_robots_txt' ), 20 );
			$public  = '0' !== (string) get_option( 'blog_public', '1' );
			$default = (string) apply_filters( 'robots_txt', self::core_robots( $public ), $public ); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals
			if ( 'custom' === $settings['robots_mode'] ) {
				add_filter( 'robots_txt', array( __CLASS__, 'filter_robots_txt' ), 20, 2 );
			}
		}
		return array(
			'settings'          => array(
				'verify'      => $settings['verify'],
				'robots_mode' => $settings['robots_mode'],
				'robots_text' => $texts['robots'],
				'llms_mode'   => $settings['llms_mode'],
				'llms_text'   => $texts['llms'],
				'indexnow'    => $settings['indexnow'],
			),
			'conflict'          => KontrolWP_Connect_SEO::conflict(),
			'public'            => '0' !== (string) get_option( 'blog_public', '1' ),
			'robots_file_exists' => file_exists( ABSPATH . 'robots.txt' ),
			'robots_default'    => $default,
			'llms_auto'         => self::llms_auto(
				html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
				KontrolWP_Connect_SEO::usable_tagline( html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' ) ),
				self::listing( 'page', 20, 'menu_order title', 'ASC' ),
				self::listing( 'post', 20, 'date', 'DESC' )
			),
			'urls'              => array(
				'robots' => home_url( '/robots.txt' ),
				'llms'   => home_url( '/llms.txt' ),
			),
		);
	}

	/** What WordPress prints before plugins change it. */
	private static function core_robots( $public ) {
		$site_path = wp_parse_url( site_url(), PHP_URL_PATH );
		$out       = "User-agent: *\n";
		if ( $public ) {
			$out .= 'Disallow: ' . $site_path . "/wp-admin/\n";
			$out .= 'Allow: ' . $site_path . "/wp-admin/admin-ajax.php\n";
		} else {
			$out .= "Disallow: /\n";
		}
		return $out;
	}

	public static function report_route() {
		return self::report();
	}

	public static function save_route( $request ) {
		$body = $request->get_json_params();
		$body = is_array( $body ) ? $body : array();
		$new  = self::clean( $body );
		$old  = self::settings();
		$texts = self::texts();

		$robots = isset( $body['robots_text'] ) && is_string( $body['robots_text'] ) ? $body['robots_text'] : $texts['robots'];
		$llms   = isset( $body['llms_text'] ) && is_string( $body['llms_text'] ) ? $body['llms_text'] : $texts['llms'];
		if ( 'custom' === $new['robots_mode'] ) {
			$error = self::robots_error( $robots );
			if ( '' !== $error ) {
				return new WP_Error( 'kontrolwp_invalid_robots', $error, array( 'status' => 400 ) );
			}
		}
		if ( strlen( $llms ) > self::MAX_LLMS ) {
			return new WP_Error( 'kontrolwp_invalid_llms', 'llms.txt can be up to ' . self::MAX_LLMS . ' characters.', array( 'status' => 400 ) );
		}
		// IndexNow needs a key that stays the same, so it is made once and kept.
		if ( $new['indexnow'] && '' === $new['indexnow_key'] ) {
			$new['indexnow_key'] = '' !== $old['indexnow_key'] ? $old['indexnow_key'] : wp_generate_password( 32, false, false );
		}
		if ( '' === $new['indexnow_key'] && '' !== $old['indexnow_key'] ) {
			$new['indexnow_key'] = $old['indexnow_key'];
		}
		update_option( self::OPTION, $new, true );
		update_option(
			self::TEXTS_OPTION,
			array(
				'robots' => str_replace( array( "\r\n", "\r" ), "\n", $robots ),
				'llms'   => str_replace( array( "\r\n", "\r" ), "\n", $llms ),
			),
			false
		);
		delete_transient( 'kontrolwp_connect_llms' );
		return self::report();
	}
}
