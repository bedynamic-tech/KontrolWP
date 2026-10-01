<?php
/**
 * The links in this site's published content, for the dashboard's link
 * checker. The site only lists them; the dashboard checks each address, so
 * a scan never slows the site down.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Links {

	/** Most posts one page of the listing covers. */
	const MAX_PER_PAGE = 100;

	public static function register_routes( $auth ) {
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/links',
			array(
				// POST so the page number is in the signed body.
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'index' ),
				'permission_callback' => $auth,
				'args'                => array(
					'page'     => array(
						'type'    => 'integer',
						'minimum' => 1,
						'default' => 1,
					),
					'per_page' => array(
						'type'    => 'integer',
						'minimum' => 1,
						'maximum' => self::MAX_PER_PAGE,
						'default' => 50,
					),
					// Just these posts, to see whether a link is still in them (0.9.2).
					'post_ids' => array(
						'type'     => 'array',
						'items'    => array(
							'type'    => 'integer',
							'minimum' => 1,
						),
						'maxItems' => self::MAX_PER_PAGE,
						'default'  => array(),
					),
				),
			)
		);
	}

	/** Public content types: posts, pages and any public custom type, without media. */
	private static function post_types() {
		$types = get_post_types( array( 'public' => true ) );
		unset( $types['attachment'] );
		return array_values( $types );
	}

	/**
	 * One page of published content, each item with the links and images in it.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function index( $request ) {
		$ids  = array_values( array_unique( array_map( 'intval', (array) $request['post_ids'] ) ) );
		$args = array(
			'posts_per_page' => (int) $request['per_page'],
			'paged'          => (int) $request['page'],
		);
		if ( $ids ) {
			// A post that is gone, unpublished or not public content is left out.
			$args = array(
				'post__in'       => $ids,
				'posts_per_page' => count( $ids ),
				'paged'          => 1,
			);
		}
		$query = new WP_Query(
			array_merge(
				$args,
				array(
					'post_type'              => self::post_types(),
					'post_status'            => 'publish',
					'orderby'                => 'ID',
					'order'                  => 'ASC',
					'no_found_rows'          => false,
					'update_post_meta_cache' => false,
					'update_post_term_cache' => false,
				)
			)
		);

		$items = array();
		foreach ( $query->posts as $post ) {
			$permalink = get_permalink( $post );
			$links     = self::extract( (string) $post->post_content, $permalink ? $permalink : home_url( '/' ) );
			if ( ! $links ) {
				continue;
			}
			$items[] = array(
				'post_id'   => (int) $post->ID,
				'title'     => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
				'type'      => $post->post_type,
				'permalink' => $permalink ? $permalink : '',
				'links'     => $links,
			);
		}

		return array(
			'items'       => $items,
			'page'        => (int) $request['page'],
			'total_pages' => (int) $query->max_num_pages,
			'total_posts' => (int) $query->found_posts,
		);
	}

	/**
	 * The http(s) addresses in a post's links and images, made absolute.
	 * Anchors within the page, mailto: and tel: links are left out.
	 *
	 * @param string $html Post content.
	 * @param string $base The post's own address, for relative links.
	 */
	public static function extract( $html, $base ) {
		$found = array();
		$add   = static function ( $url, $text, $kind ) use ( &$found, $base ) {
			$absolute = self::absolute( trim( html_entity_decode( (string) $url, ENT_QUOTES, 'UTF-8' ) ), $base );
			if ( ! $absolute ) {
				return;
			}
			$key = $kind . ' ' . $absolute;
			if ( ! isset( $found[ $key ] ) ) {
				$found[ $key ] = array(
					'url'  => $absolute,
					'text' => mb_substr( trim( wp_strip_all_tags( (string) $text ) ), 0, 120 ),
					'kind' => $kind,
				);
			}
		};

		if ( class_exists( 'WP_HTML_Tag_Processor' ) ) {
			// WordPress 6.2+: a real HTML parser. Link text is read separately below.
			$tags = new WP_HTML_Tag_Processor( $html );
			while ( $tags->next_tag() ) {
				$name = $tags->get_tag();
				if ( 'A' === $name ) {
					$href = $tags->get_attribute( 'href' );
					if ( is_string( $href ) ) {
						$add( $href, self::anchor_text( $html, $href ), 'link' );
					}
				} elseif ( 'IMG' === $name ) {
					$src = $tags->get_attribute( 'src' );
					if ( is_string( $src ) ) {
						$alt = $tags->get_attribute( 'alt' );
						$add( $src, is_string( $alt ) ? $alt : '', 'image' );
					}
				}
			}
		} else {
			preg_match_all( '/<a\s[^>]*href=(["\'])(.*?)\1[^>]*>(.*?)<\/a>/is', $html, $links, PREG_SET_ORDER );
			foreach ( $links as $match ) {
				$add( $match[2], $match[3], 'link' );
			}
			preg_match_all( '/<img\s[^>]*src=(["\'])(.*?)\1/is', $html, $images, PREG_SET_ORDER );
			foreach ( $images as $match ) {
				$add( $match[2], '', 'image' );
			}
		}

		return array_values( $found );
	}

	/** The visible text of the first link to $href, for the table's "Link text" column. */
	private static function anchor_text( $html, $href ) {
		// The parser decodes the attribute; the HTML may still hold it encoded (&amp;).
		foreach ( array_unique( array( $href, str_replace( '&', '&amp;', $href ) ) ) as $variant ) {
			$pattern = '/<a\s[^>]*href=(["\'])' . preg_quote( $variant, '/' ) . '\1[^>]*>(.*?)<\/a>/is';
			if ( preg_match( $pattern, $html, $match ) ) {
				return $match[2];
			}
		}
		return '';
	}

	/** An absolute http(s) address, or null for anything else. */
	private static function absolute( $url, $base ) {
		if ( '' === $url || '#' === $url[0] ) {
			return null;
		}
		if ( 0 === strpos( $url, '//' ) ) {
			$url = ( is_ssl() ? 'https:' : 'http:' ) . $url;
		} elseif ( ! preg_match( '#^[a-z][a-z0-9+.-]*:#i', $url ) ) {
			$parts  = wp_parse_url( $base );
			$origin = $parts['scheme'] . '://' . $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
			if ( '/' === $url[0] ) {
				$url = $origin . $url;
			} else {
				$path = isset( $parts['path'] ) ? preg_replace( '#[^/]*$#', '', $parts['path'] ) : '/';
				$url  = $origin . $path . $url;
			}
		}
		$scheme = strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) );
		if ( 'http' !== $scheme && 'https' !== $scheme ) {
			return null;
		}
		// The fragment never changes whether the page loads.
		$hash = strpos( $url, '#' );
		return false === $hash ? $url : substr( $url, 0, $hash );
	}
}
