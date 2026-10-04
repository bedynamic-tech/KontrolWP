<?php
/**
 * What SEO adds to a site's own content (0.21.0): site-wide schema (the
 * website, and the organization or person behind it), article schema,
 * breadcrumbs, rules for external links, automatic image alt text, and a
 * footer on feed items.
 *
 * Like the rest of SEO this prints and changes nothing while SEO is switched
 * off or another SEO plugin is active, and never edits stored content: every
 * change is made as a page is rendered.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_SEO_Content {

	const OPTION = 'kontrolwp_connect_seo_content';

	const DEFAULT_FEED_FOOTER = 'The post %title% first appeared on %sitename%.';

	const DEFAULTS = array(
		'schema'            => true,
		'schema_type'       => 'organization',
		'schema_name'       => '',
		'schema_logo'       => '',
		'schema_same_as'    => array(),
		'article_schema'    => true,
		'breadcrumbs'       => true,
		'breadcrumb_home'   => 'Home',
		'breadcrumb_sep'    => '›',
		'external_new_tab'  => false,
		'external_nofollow' => false,
		'image_alt'         => true,
		'image_title'       => false,
		'feed_footer'       => self::DEFAULT_FEED_FOOTER,
	);

	/** What a site that already uses SEO gets until it saves these: nothing new on its pages. */
	const UNCHANGED_FOR_EXISTING = array(
		'schema'         => false,
		'article_schema' => false,
		'breadcrumbs'    => false,
		'image_alt'      => false,
		'feed_footer'    => '',
	);

	const BREADCRUMB_SEPARATORS = array( '›', '/', '>', '»', '-', '|' );

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/seo/content'      => 'report_route',
			'/seo/content/save' => 'save_route',
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

	/** Settings from untrusted input: only known keys of the right shape. */
	public static function clean( $input ) {
		$out = self::DEFAULTS;
		foreach ( array( 'schema', 'article_schema', 'breadcrumbs', 'external_new_tab', 'external_nofollow', 'image_alt', 'image_title' ) as $key ) {
			if ( array_key_exists( $key, $input ) ) {
				$out[ $key ] = (bool) $input[ $key ];
			}
		}
		if ( isset( $input['schema_type'] ) && in_array( $input['schema_type'], array( 'organization', 'person' ), true ) ) {
			$out['schema_type'] = $input['schema_type'];
		}
		foreach ( array( 'schema_name' => 200, 'breadcrumb_home' => 60, 'feed_footer' => 500 ) as $key => $max ) {
			if ( isset( $input[ $key ] ) && is_string( $input[ $key ] ) ) {
				$text        = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $input[ $key ] ) ) );
				$out[ $key ] = function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max ) : substr( $text, 0, $max );
			}
		}
		if ( '' === $out['breadcrumb_home'] ) {
			$out['breadcrumb_home'] = self::DEFAULTS['breadcrumb_home'];
		}
		if ( isset( $input['breadcrumb_sep'] ) && in_array( $input['breadcrumb_sep'], self::BREADCRUMB_SEPARATORS, true ) ) {
			$out['breadcrumb_sep'] = $input['breadcrumb_sep'];
		}
		if ( isset( $input['schema_logo'] ) && is_string( $input['schema_logo'] ) ) {
			$out['schema_logo'] = self::url( $input['schema_logo'] );
		}
		if ( isset( $input['schema_same_as'] ) && is_array( $input['schema_same_as'] ) ) {
			$links = array();
			foreach ( array_slice( $input['schema_same_as'], 0, 20 ) as $link ) {
				$link = is_string( $link ) ? self::url( $link ) : '';
				if ( '' !== $link ) {
					$links[] = $link;
				}
			}
			$out['schema_same_as'] = array_values( array_unique( $links ) );
		}
		return $out;
	}

	private static function url( $value ) {
		$value = trim( $value );
		return preg_match( '#^https?://[^\s<>"\']+$#i', $value ) && strlen( $value ) <= 2000 ? $value : '';
	}

	/** Whether a link leaves the site. Relative links, mail and phone links, and the site's own host stay. */
	public static function is_external( $href, $home_host ) {
		if ( ! preg_match( '#^(?:https?:)?//([^/?\#:]+)#i', trim( (string) $href ), $m ) ) {
			return false;
		}
		$strip = function ( $host ) {
			return preg_replace( '/^www\./', '', strtolower( (string) $host ) );
		};
		return $strip( $m[1] ) !== $strip( $home_host );
	}

	/** A link's rel with the tokens this needs added, keeping what was there. */
	public static function merge_rel( $existing, $tokens ) {
		$have = preg_split( '/\s+/', strtolower( trim( (string) $existing ) ), -1, PREG_SPLIT_NO_EMPTY );
		foreach ( $tokens as $token ) {
			if ( ! in_array( $token, $have, true ) ) {
				$have[] = $token;
			}
		}
		return implode( ' ', $have );
	}

	/** Alt text from an attachment's title, or an empty string when the title is only a camera or file name. */
	public static function alt_from_title( $title ) {
		$text = trim( preg_replace( '/\s+/', ' ', str_replace( array( '-', '_' ), ' ', (string) $title ) ) );
		if ( '' === $text || preg_match( '/^(?:img|dsc|dscn|image|photo|pic|picture|screenshot|scan|untitled|unnamed)?\s*[\d\s]*$/i', $text ) || preg_match( '/\.(?:jpe?g|png|gif|webp|avif)$/i', $text ) ) {
			return '';
		}
		return $text;
	}

	/**
	 * A title attribute for an image: its media library title, or its file name
	 * when the title is only a camera name. Empty when neither says anything.
	 */
	public static function image_title_text( $post_title, $file_name ) {
		$text = self::alt_from_title( $post_title );
		if ( '' !== $text ) {
			return $text;
		}
		return self::alt_from_title( preg_replace( '/\.[A-Za-z0-9]{2,5}$/', '', (string) $file_name ) );
	}

	/** The feed footer with its tokens filled in. */
	public static function feed_footer( $template, $vars ) {
		return preg_replace_callback(
			'/%(title|link|sitename)%/',
			function ( $m ) use ( $vars ) {
				return isset( $vars[ $m[1] ] ) ? $vars[ $m[1] ] : '';
			},
			$template
		);
	}

	/** schema.org BreadcrumbList for a trail of array( label, url ). */
	public static function breadcrumb_schema( $trail ) {
		$items = array();
		foreach ( array_values( $trail ) as $i => $crumb ) {
			$item = array(
				'@type'    => 'ListItem',
				'position' => $i + 1,
				'name'     => $crumb[0],
			);
			if ( '' !== $crumb[1] ) {
				$item['item'] = $crumb[1];
			}
			$items[] = $item;
		}
		return array(
			'@type'           => 'BreadcrumbList',
			'itemListElement' => $items,
		);
	}

	/** The breadcrumb trail as HTML. The last crumb is the current page and is not a link. */
	public static function breadcrumb_html( $trail, $sep ) {
		if ( count( $trail ) < 2 ) {
			return '';
		}
		$esc   = function ( $value ) {
			return htmlspecialchars( (string) $value, ENT_QUOTES, 'UTF-8' );
		};
		$last  = count( $trail ) - 1;
		$parts = array();
		foreach ( array_values( $trail ) as $i => $crumb ) {
			$parts[] = $i === $last || '' === $crumb[1]
				? '<li aria-current="page">' . $esc( $crumb[0] ) . '</li>'
				: '<li><a href="' . $esc( $crumb[1] ) . '">' . $esc( $crumb[0] ) . '</a></li>';
		}
		return '<nav class="kontrolwp-breadcrumbs" aria-label="Breadcrumb"><ol style="list-style:none;display:flex;flex-wrap:wrap;gap:.4em;margin:0;padding:0">'
			. implode( '<li aria-hidden="true">' . $esc( $sep ) . '</li>', $parts )
			. '</ol></nav>';
	}

	/**
	 * The site-wide schema graph. $site keys: name, url, language, logo (an
	 * address or empty), description. Always the website, and the
	 * organization or person behind it.
	 */
	public static function site_graph( $settings, $site ) {
		$name = '' !== $settings['schema_name'] ? $settings['schema_name'] : $site['name'];
		$id   = $site['url'] . '#' . $settings['schema_type'];
		$node = array(
			'@type' => 'person' === $settings['schema_type'] ? 'Person' : 'Organization',
			'@id'   => $id,
			'name'  => $name,
			'url'   => $site['url'],
		);
		$logo = '' !== $settings['schema_logo'] ? $settings['schema_logo'] : $site['logo'];
		if ( '' !== $logo ) {
			$node['logo'] = 'person' === $settings['schema_type'] ? $logo : array(
				'@type' => 'ImageObject',
				'url'   => $logo,
			);
			if ( 'person' === $settings['schema_type'] ) {
				$node['image'] = $logo;
			}
		}
		if ( $settings['schema_same_as'] ) {
			$node['sameAs'] = $settings['schema_same_as'];
		}
		$website = array(
			'@type'     => 'WebSite',
			'@id'       => $site['url'] . '#website',
			'url'       => $site['url'],
			'name'      => $site['name'],
			'publisher' => array( '@id' => $id ),
		);
		if ( '' !== $site['description'] ) {
			$website['description'] = $site['description'];
		}
		if ( '' !== $site['language'] ) {
			$website['inLanguage'] = $site['language'];
		}
		return array( $website, $node );
	}

	/**
	 * Article schema for a post. $post keys: url, title, description, image,
	 * published, modified, author_name, author_url.
	 */
	public static function article_node( $settings, $site, $post ) {
		$node = array(
			'@type'            => 'Article',
			'@id'              => $post['url'] . '#article',
			'mainEntityOfPage' => $post['url'],
			'headline'         => $post['title'],
			'datePublished'    => $post['published'],
			'dateModified'     => $post['modified'],
			'publisher'        => array( '@id' => $site['url'] . '#' . $settings['schema_type'] ),
			'isPartOf'         => array( '@id' => $site['url'] . '#website' ),
		);
		if ( '' !== $post['description'] ) {
			$node['description'] = $post['description'];
		}
		if ( '' !== $post['image'] ) {
			$node['image'] = $post['image'];
		}
		if ( '' !== $post['author_name'] ) {
			$author = array(
				'@type' => 'Person',
				'name'  => $post['author_name'],
			);
			if ( '' !== $post['author_url'] ) {
				$author['url'] = $post['author_url'];
			}
			$node['author'] = $author;
		}
		return $node;
	}

	/* ---- Storage ---- */

	public static function settings() {
		$saved = get_option( self::OPTION, false );
		if ( is_array( $saved ) ) {
			return self::clean( $saved );
		}
		// Never saved: a site that already uses SEO keeps its pages as they are; a new one gets the defaults.
		return self::clean( is_array( get_option( KontrolWP_Connect_SEO::OPTION, false ) ) ? self::UNCHANGED_FOR_EXISTING : array() );
	}

	/** Whether this class does anything on the front end: SEO on, and no other SEO plugin. */
	private static function active() {
		$seo = KontrolWP_Connect_SEO::settings();
		return ! empty( $seo['enabled'] ) && '' === KontrolWP_Connect_SEO::conflict();
	}

	/* ---- Front end ---- */

	public static function boot() {
		if ( ! self::active() ) {
			return;
		}
		$settings = self::settings();
		if ( $settings['schema'] || $settings['article_schema'] || $settings['breadcrumbs'] ) {
			add_action( 'wp_head', array( __CLASS__, 'print_schema' ), 3 );
		}
		add_shortcode( 'kontrolwp_breadcrumbs', array( __CLASS__, 'shortcode' ) );
		if ( $settings['external_new_tab'] || $settings['external_nofollow'] || $settings['image_alt'] || $settings['image_title'] ) {
			add_filter( 'the_content', array( __CLASS__, 'filter_content' ), 20 );
		}
		if ( $settings['image_title'] ) {
			add_filter( 'wp_get_attachment_image_attributes', array( __CLASS__, 'filter_image_attributes' ), 20, 2 );
		}
		if ( '' !== $settings['feed_footer'] ) {
			add_filter( 'the_content_feed', array( __CLASS__, 'filter_feed' ) );
			add_filter( 'the_excerpt_rss', array( __CLASS__, 'filter_feed' ) );
		}
	}

	private static function site_facts() {
		$icon = get_site_icon_url( 512 );
		return array(
			'name'        => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
			'url'         => home_url( '/' ),
			'language'    => str_replace( '_', '-', get_locale() ),
			'logo'        => $icon ? $icon : '',
			'description' => KontrolWP_Connect_SEO::usable_tagline( html_entity_decode( get_bloginfo( 'description' ), ENT_QUOTES, 'UTF-8' ) ),
		);
	}

	/** The trail of array( label, url ) down to the current page, or an empty list where there is none. */
	public static function trail() {
		$settings = self::settings();
		$trail    = array( array( $settings['breadcrumb_home'], home_url( '/' ) ) );
		if ( is_front_page() || is_home() ) {
			return array();
		}
		$title = function ( $post ) {
			return html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' );
		};
		if ( is_singular() ) {
			$post = get_queried_object();
			if ( ! $post ) {
				return array();
			}
			if ( is_post_type_hierarchical( $post->post_type ) ) {
				foreach ( array_reverse( get_post_ancestors( $post ) ) as $ancestor_id ) {
					$trail[] = array( $title( $ancestor_id ), (string) get_permalink( $ancestor_id ) );
				}
			} else {
				$taxonomy = 'post' === $post->post_type ? 'category' : '';
				$terms    = $taxonomy ? get_the_terms( $post, $taxonomy ) : false;
				if ( is_array( $terms ) && $terms ) {
					$term = reset( $terms );
					foreach ( array_reverse( get_ancestors( $term->term_id, $taxonomy, 'taxonomy' ) ) as $ancestor_id ) {
						$ancestor = get_term( $ancestor_id, $taxonomy );
						$link     = $ancestor && ! is_wp_error( $ancestor ) ? get_term_link( $ancestor ) : '';
						if ( $ancestor && ! is_wp_error( $ancestor ) && is_string( $link ) ) {
							$trail[] = array( html_entity_decode( $ancestor->name, ENT_QUOTES, 'UTF-8' ), $link );
						}
					}
					$link = get_term_link( $term );
					if ( is_string( $link ) ) {
						$trail[] = array( html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' ), $link );
					}
				}
			}
			$trail[] = array( $title( $post ), (string) get_permalink( $post ) );
		} elseif ( is_category() || is_tag() || is_tax() ) {
			$term = get_queried_object();
			if ( ! $term || ! isset( $term->taxonomy ) ) {
				return array();
			}
			foreach ( array_reverse( get_ancestors( $term->term_id, $term->taxonomy, 'taxonomy' ) ) as $ancestor_id ) {
				$ancestor = get_term( $ancestor_id, $term->taxonomy );
				$link     = $ancestor && ! is_wp_error( $ancestor ) ? get_term_link( $ancestor ) : '';
				if ( is_string( $link ) && $ancestor && ! is_wp_error( $ancestor ) ) {
					$trail[] = array( html_entity_decode( $ancestor->name, ENT_QUOTES, 'UTF-8' ), $link );
				}
			}
			$link    = get_term_link( $term );
			$trail[] = array( html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' ), is_string( $link ) ? $link : '' );
		} else {
			return array();
		}
		return $trail;
	}

	public static function print_schema() {
		$settings = self::settings();
		$site     = self::site_facts();
		$graph    = array();
		if ( ( is_front_page() || is_home() ) && $settings['schema'] ) {
			$graph = self::site_graph( $settings, $site );
		}
		if ( is_singular( 'post' ) && $settings['article_schema'] ) {
			$post = get_queried_object();
			if ( $post ) {
				$description = (string) get_post_meta( $post->ID, KontrolWP_Connect_SEO::META_DESCRIPTION, true );
				if ( '' === $description ) {
					$description = KontrolWP_Connect_SEO::trim_description( '' !== trim( (string) $post->post_excerpt ) ? $post->post_excerpt : $post->post_content );
				}
				$image = (string) get_post_meta( $post->ID, KontrolWP_Connect_SEO::META_IMAGE, true );
				if ( '' === $image ) {
					$thumb = get_the_post_thumbnail_url( $post, 'large' );
					$image = $thumb ? $thumb : '';
				}
				$graph[] = self::article_node(
					$settings,
					$site,
					array(
						'url'         => (string) get_permalink( $post ),
						'title'       => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
						'description' => $description,
						'image'       => $image,
						'published'   => (string) get_the_date( 'c', $post ),
						'modified'    => (string) get_the_modified_date( 'c', $post ),
						'author_name' => (string) get_the_author_meta( 'display_name', $post->post_author ),
						'author_url'  => (string) get_author_posts_url( (int) $post->post_author ),
					)
				);
			}
		}
		if ( $settings['breadcrumbs'] ) {
			$trail = self::trail();
			if ( count( $trail ) > 1 ) {
				$graph[] = self::breadcrumb_schema( $trail );
			}
		}
		if ( ! $graph ) {
			return;
		}
		echo '<script type="application/ld+json">' // phpcs:ignore WordPress.Security.EscapeOutput
			. wp_json_encode(
				array(
					'@context' => 'https://schema.org',
					'@graph'   => $graph,
				),
				JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP
			)
			. "</script>\n";
	}

	/** [kontrolwp_breadcrumbs], and kontrolwp_breadcrumbs() for a theme. */
	public static function shortcode() {
		$settings = self::settings();
		return $settings['breadcrumbs'] ? self::breadcrumb_html( self::trail(), $settings['breadcrumb_sep'] ) : '';
	}

	/** Content as it is shown: external link rules and alt text for images that have none. */
	public static function filter_content( $content ) {
		if ( ! class_exists( 'WP_HTML_Tag_Processor' ) || '' === $content || ( false === strpos( $content, '<a ' ) && false === strpos( $content, '<img' ) ) ) {
			return $content;
		}
		$settings  = self::settings();
		$home_host = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		$tags      = new WP_HTML_Tag_Processor( $content );
		while ( $tags->next_tag() ) {
			$tag = $tags->get_tag();
			if ( 'A' === $tag && ( $settings['external_new_tab'] || $settings['external_nofollow'] ) ) {
				$href = $tags->get_attribute( 'href' );
				if ( is_string( $href ) && self::is_external( $href, $home_host ) ) {
					$rel = array();
					if ( $settings['external_nofollow'] ) {
						$rel[] = 'nofollow';
					}
					if ( $settings['external_new_tab'] && null === $tags->get_attribute( 'target' ) ) {
						$tags->set_attribute( 'target', '_blank' );
					}
					if ( '_blank' === $tags->get_attribute( 'target' ) ) {
						$rel[] = 'noopener';
					}
					if ( $rel ) {
						$existing = $tags->get_attribute( 'rel' );
						$tags->set_attribute( 'rel', self::merge_rel( is_string( $existing ) ? $existing : '', $rel ) );
					}
				}
			} elseif ( 'IMG' === $tag ) {
				if ( $settings['image_alt'] && null === $tags->get_attribute( 'alt' ) ) {
					$alt = self::alt_for_image( (string) $tags->get_attribute( 'class' ) );
					if ( '' !== $alt ) {
						$tags->set_attribute( 'alt', $alt );
					}
				}
				if ( $settings['image_title'] && null === $tags->get_attribute( 'title' ) ) {
					$title = self::title_for_image( (string) $tags->get_attribute( 'class' ) );
					if ( '' !== $title ) {
						$tags->set_attribute( 'title', $title );
					}
				}
			}
		}
		return $tags->get_updated_html();
	}

	/** Alt text for an image from the media library, found by the wp-image-ID class WordPress puts on it. */
	private static function alt_for_image( $class ) {
		if ( ! preg_match( '/\bwp-image-(\d+)\b/', $class, $m ) ) {
			return '';
		}
		$alt = (string) get_post_meta( (int) $m[1], '_wp_attachment_image_alt', true );
		if ( '' !== trim( $alt ) ) {
			return $alt;
		}
		return self::alt_from_title( get_the_title( (int) $m[1] ) );
	}

	/** A title attribute for an image from the media library, found by the wp-image-ID class. */
	private static function title_for_image( $class ) {
		if ( ! preg_match( '/\bwp-image-(\d+)\b/', $class, $m ) ) {
			return '';
		}
		return self::title_for_attachment( (int) $m[1] );
	}

	private static function title_for_attachment( $id ) {
		$file = get_attached_file( $id );
		return self::image_title_text( get_the_title( $id ), $file ? wp_basename( $file ) : '' );
	}

	/** Images a theme prints with wp_get_attachment_image, such as featured images, get the same title. */
	public static function filter_image_attributes( $attr, $attachment ) {
		if ( is_array( $attr ) && empty( $attr['title'] ) && $attachment && isset( $attachment->ID ) ) {
			$title = self::title_for_attachment( (int) $attachment->ID );
			if ( '' !== $title ) {
				$attr['title'] = $title;
			}
		}
		return $attr;
	}

	/** Add the footer to a feed item. */
	public static function filter_feed( $content ) {
		$settings = self::settings();
		$post     = get_post();
		if ( ! $post || '' === $settings['feed_footer'] ) {
			return $content;
		}
		$footer = self::feed_footer(
			$settings['feed_footer'],
			array(
				'title'    => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
				'link'     => (string) get_permalink( $post ),
				'sitename' => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
			)
		);
		return $content . '<p>' . esc_html( $footer ) . '</p>';
	}

	/* ---- Dashboard routes ---- */

	public static function report() {
		return array(
			'settings'      => self::settings(),
			'conflict'      => KontrolWP_Connect_SEO::conflict(),
			'seo_enabled'   => (bool) KontrolWP_Connect_SEO::settings()['enabled'],
			'html_support'  => class_exists( 'WP_HTML_Tag_Processor' ),
			'site_icon'     => (string) get_site_icon_url( 512 ),
			'site_name'     => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
		);
	}

	public static function report_route() {
		return self::report();
	}

	public static function save_route( $request ) {
		$body = $request->get_json_params();
		update_option( self::OPTION, self::clean( is_array( $body ) ? $body : array() ), true );
		return self::report();
	}
}

/** Breadcrumbs for a theme: echo kontrolwp_breadcrumbs(); */
function kontrolwp_breadcrumbs() {
	return KontrolWP_Connect_SEO_Content::shortcode();
}
