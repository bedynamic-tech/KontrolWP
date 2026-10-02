<?php
/**
 * Accessibility fixes the dashboard's Accessibility tab can switch on (0.14.0).
 * Each one is saved as an option and applied to the pages visitors see as they
 * are sent, by rewriting the finished HTML. Nothing in the database or the
 * theme changes, so switching a fix off puts every page back as it was.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Accessibility {

	const OPTION = 'kontrolwp_connect_accessibility';

	/** The fixes the dashboard can switch on, in the order it lists them. */
	const FIXES = array( 'image_alt', 'form_labels', 'link_names', 'frame_titles', 'viewport_zoom', 'skip_link' );

	/** Names for links that only hold an icon, by the site they go to. */
	const SITE_NAMES = array(
		'facebook.com'  => 'Facebook',
		'twitter.com'   => 'Twitter',
		'x.com'         => 'X',
		'instagram.com' => 'Instagram',
		'linkedin.com'  => 'LinkedIn',
		'youtube.com'   => 'YouTube',
		'tiktok.com'    => 'TikTok',
		'pinterest.com' => 'Pinterest',
		'github.com'    => 'GitHub',
		'threads.net'   => 'Threads',
	);

	public static function register_routes( $auth ) {
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/accessibility',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'report' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/accessibility/fixes',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'set_fixes' ),
				'permission_callback' => $auth,
				'args'                => array(
					'ids'     => array(
						'type'     => 'array',
						'required' => true,
						'items'    => array(
							'type' => 'string',
							'enum' => self::FIXES,
						),
					),
					'enabled' => array(
						'type'     => 'boolean',
						'required' => true,
					),
				),
			)
		);
	}

	/** The fixes switched on in the dashboard. */
	private static function enabled() {
		$saved = get_option( self::OPTION, array() );
		return is_array( $saved ) ? array_values( array_intersect( self::FIXES, $saved ) ) : array();
	}

	/** Start rewriting pages when any fix is on. Runs every time the plugin loads. */
	public static function boot() {
		if ( self::enabled() ) {
			add_action( 'template_redirect', array( __CLASS__, 'start' ), 0 );
		}
	}

	/** Only the pages visitors read are rewritten, never the admin, feeds, REST or Ajax. */
	public static function start() {
		if ( is_admin() || is_feed() || is_robots() || is_trackback() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		ob_start( array( __CLASS__, 'rewrite' ) );
	}

	/** Output buffer callback; a page is sent as it was if anything goes wrong. */
	public static function rewrite( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '<html' ) ) {
			return $html;
		}
		try {
			$out = self::transform( $html, self::enabled() );
		} catch ( \Throwable $e ) {
			return $html;
		}
		return is_string( $out ) && '' !== $out ? $out : $html;
	}

	/** Apply the named fixes to one page of HTML. */
	public static function transform( $html, $fixes ) {
		if ( in_array( 'viewport_zoom', $fixes, true ) ) {
			$html = self::fix_viewport( $html );
		}
		if ( in_array( 'image_alt', $fixes, true ) ) {
			$html = self::fix_images( $html );
		}
		if ( in_array( 'frame_titles', $fixes, true ) ) {
			$html = self::fix_frames( $html );
		}
		if ( in_array( 'form_labels', $fixes, true ) ) {
			$html = self::fix_fields( $html );
		}
		if ( in_array( 'link_names', $fixes, true ) ) {
			$html = self::fix_links( $html );
		}
		if ( in_array( 'skip_link', $fixes, true ) ) {
			$html = self::fix_skip_link( $html );
		}
		return $html;
	}

	/** The value of an attribute in one tag, or null when it has none. */
	private static function attr( $tag, $name ) {
		if ( preg_match( '/\s' . preg_quote( $name, '/' ) . '\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>"\']+))/i', $tag, $m ) ) {
			foreach ( array( 1, 2, 3 ) as $i ) {
				if ( isset( $m[ $i ] ) && '' !== $m[ $i ] ) {
					return html_entity_decode( $m[ $i ], ENT_QUOTES, 'UTF-8' );
				}
			}
			return '';
		}
		return null;
	}

	/** Whether the tag has the attribute at all, with or without a value. */
	private static function has_attr( $tag, $name ) {
		return (bool) preg_match( '/\s' . preg_quote( $name, '/' ) . '(?=[\s=\/>])/i', $tag );
	}

	/** The tag with one more attribute before its closing bracket. */
	private static function with_attr( $tag, $name, $value ) {
		$attr = ' ' . $name . '="' . htmlspecialchars( $value, ENT_QUOTES, 'UTF-8' ) . '"';
		return preg_replace( '/\s*\/?>$/', $attr . '$0', $tag, 1 );
	}

	/** Zooming stays possible: a viewport that forbids it is rewritten. */
	private static function fix_viewport( $html ) {
		return preg_replace_callback(
			'/<meta\b[^>]*\bname\s*=\s*["\']?viewport["\']?[^>]*>/i',
			function ( $m ) {
				$tag = $m[0];
				$tag = preg_replace( '/,?\s*user-scalable\s*=\s*(?:no|0)/i', '', $tag );
				$tag = preg_replace_callback(
					'/,?\s*maximum-scale\s*=\s*([0-9.]+)/i',
					function ( $s ) {
						return (float) $s[1] < 5 ? '' : $s[0];
					},
					$tag
				);
				return preg_replace( '/content\s*=\s*(["\'])\s*,\s*/i', 'content=$1', $tag );
			},
			$html
		);
	}

	/** An image with no alt attribute is marked decorative (alt=""), which screen readers skip. */
	private static function fix_images( $html ) {
		return preg_replace_callback(
			'/<img\b[^>]*>/i',
			function ( $m ) {
				return self::has_attr( $m[0], 'alt' ) ? $m[0] : self::with_attr( $m[0], 'alt', '' );
			},
			$html
		);
	}

	/** An embedded frame with no title is named for the site it shows. */
	private static function fix_frames( $html ) {
		return preg_replace_callback(
			'/<iframe\b[^>]*>/i',
			function ( $m ) {
				$title = self::attr( $m[0], 'title' );
				if ( null !== $title && '' !== trim( $title ) ) {
					return $m[0];
				}
				$src  = self::attr( $m[0], 'src' );
				$host = $src ? self::host( $src ) : '';
				$name = $host ? 'Embedded content from ' . $host : 'Embedded content';
				if ( null !== $title ) {
					return preg_replace( '/\stitle\s*=\s*(?:"[^"]*"|\'[^\']*\')/i', ' title="' . htmlspecialchars( $name, ENT_QUOTES, 'UTF-8' ) . '"', $m[0], 1 );
				}
				return self::with_attr( $m[0], 'title', $name );
			},
			$html
		);
	}

	/** A field with no label is named from its placeholder or title, when it has one. */
	private static function fix_fields( $html ) {
		preg_match_all( '/<label\b[^>]*\bfor\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>"\']+))/i', $html, $labels, PREG_SET_ORDER );
		$for = array();
		foreach ( $labels as $label ) {
			$for[] = ( $label[1] ?? '' ) . ( $label[2] ?? '' ) . ( $label[3] ?? '' );
		}
		// Byte ranges of <label>...</label>, so a field inside one counts as labelled.
		$wrapped = array();
		if ( preg_match_all( '/<label\b.*?<\/label>/is', $html, $ranges, PREG_OFFSET_CAPTURE ) ) {
			foreach ( $ranges[0] as $range ) {
				$wrapped[] = array( $range[1], $range[1] + strlen( $range[0] ) );
			}
		}
		return preg_replace_callback(
			'/<(input|select|textarea)\b[^>]*>/i',
			function ( $m ) use ( $for, $wrapped ) {
				$tag    = $m[0][0];
				$offset = $m[0][1];
				foreach ( $wrapped as $range ) {
					if ( $offset >= $range[0] && $offset < $range[1] ) {
						return $tag;
					}
				}
				$type = strtolower( (string) self::attr( $tag, 'type' ) );
				if ( in_array( $type, array( 'hidden', 'submit', 'button', 'reset', 'image' ), true ) ) {
					return $tag;
				}
				foreach ( array( 'aria-label', 'aria-labelledby', 'title' ) as $named ) {
					$value = self::attr( $tag, $named );
					if ( null !== $value && '' !== trim( $value ) ) {
						return $tag;
					}
				}
				$id = self::attr( $tag, 'id' );
				if ( $id && in_array( $id, $for, true ) ) {
					return $tag;
				}
				$name = self::attr( $tag, 'placeholder' );
				if ( null === $name || '' === trim( $name ) ) {
					return $tag;
				}
				return self::with_attr( $tag, 'aria-label', trim( $name ) );
			},
			$html,
			-1,
			$count,
			PREG_OFFSET_CAPTURE
		);
	}

	/** A link that holds only an icon is named from its title or the site it goes to. */
	private static function fix_links( $html ) {
		return preg_replace_callback(
			'/<a\b([^>]*)>(.*?)<\/a>/is',
			function ( $m ) {
				$open  = '<a' . $m[1] . '>';
				$inner = $m[2];
				if ( null === self::attr( $open, 'href' ) ) {
					return $m[0];
				}
				foreach ( array( 'aria-label', 'aria-labelledby', 'title' ) as $named ) {
					$value = self::attr( $open, $named );
					if ( null !== $value && '' !== trim( $value ) ) {
						return $m[0];
					}
				}
				$text = trim( html_entity_decode( self::visible_text( $inner ), ENT_QUOTES, 'UTF-8' ) );
				if ( '' !== $text ) {
					return $m[0];
				}
				// Text hidden for screen readers only, or a named image or graphic, already names it.
				if ( preg_match( '/<img\b[^>]*\balt\s*=\s*["\'][^"\']+["\']|screen-reader-text|sr-only|visually-hidden|<svg\b[^>]*\baria-label|<title\b/i', $inner ) ) {
					return $m[0];
				}
				$href = (string) self::attr( $open, 'href' );
				$name = '';
				if ( 0 === stripos( $href, 'mailto:' ) ) {
					$name = 'Email';
				} elseif ( 0 === stripos( $href, 'tel:' ) ) {
					$name = 'Call';
				} else {
					$host = self::host( $href );
					$host = preg_replace( '/^www\./', '', $host );
					$name = isset( self::SITE_NAMES[ $host ] ) ? self::SITE_NAMES[ $host ] : '';
				}
				if ( '' === $name ) {
					return $m[0];
				}
				return self::with_attr( $open, 'aria-label', $name ) . $inner . '</a>';
			},
			$html
		);
	}

	/** A "Skip to content" link, shown when it takes keyboard focus, to the page's main content. */
	private static function fix_skip_link( $html ) {
		if ( ! preg_match( '/<body\b[^>]*>/i', $html, $body, PREG_OFFSET_CAPTURE ) ) {
			return $html;
		}
		$after = substr( $html, $body[0][1] + strlen( $body[0][0] ), 6000 );
		if ( preg_match( '/<a\b[^>]*\bhref\s*=\s*["\']#[^"\']+["\'][^>]*>[^<]*skip/i', $after ) ) {
			return $html;
		}
		$target = null;
		if ( preg_match( '/<main\b[^>]*>/i', $html, $main ) ) {
			$id = self::attr( $main[0], 'id' );
			if ( $id ) {
				$target = $id;
			} else {
				$target = 'kontrolwp-main';
				$html   = preg_replace( '/<main\b/i', '<main id="kontrolwp-main"', $html, 1 );
			}
		} else {
			foreach ( array( 'main', 'content', 'primary', 'site-content', 'main-content' ) as $id ) {
				if ( preg_match( '/\sid\s*=\s*["\']' . preg_quote( $id, '/' ) . '["\']/i', $html ) ) {
					$target = $id;
					break;
				}
			}
		}
		if ( null === $target ) {
			return $html;
		}
		$link = '<style>.kontrolwp-skip-link{position:absolute;left:-9999px;top:0;z-index:100000;background:#fff;color:#000;padding:.75em 1em}.kontrolwp-skip-link:focus{left:0}</style>'
			. '<a class="kontrolwp-skip-link" href="#' . htmlspecialchars( $target, ENT_QUOTES, 'UTF-8' ) . '">Skip to content</a>';
		return preg_replace( '/(<body\b[^>]*>)/i', '$1' . $link, $html, 1 );
	}

	/** The host of a link, lower case, or an empty string. */
	private static function host( $url ) {
		$host = wp_parse_url( $url, PHP_URL_HOST );
		return is_string( $host ) ? strtolower( $host ) : '';
	}

	/** A link's inner HTML as the text a reader sees. */
	private static function visible_text( $html ) {
		$html = preg_replace( '/<(script|style)\b.*?<\/\1>/is', '', $html );
		return strip_tags( $html );
	}

	/** Whether each fix is in effect: every one of them is, as soon as it is switched on. */
	private static function states() {
		$on     = self::enabled();
		$states = array();
		foreach ( self::FIXES as $id ) {
			$active        = in_array( $id, $on, true );
			$states[ $id ] = array(
				'enabled' => $active,
				'applied' => $active,
			);
		}
		return $states;
	}

	/** Switch fixes on or off. They take effect on the next page load. */
	public static function set_fixes( $request ) {
		$ids     = array_values( array_intersect( self::FIXES, (array) $request->get_param( 'ids' ) ) );
		$enabled = (bool) $request->get_param( 'enabled' );
		$saved   = self::enabled();
		$saved   = $enabled ? array_unique( array_merge( $saved, $ids ) ) : array_diff( $saved, $ids );
		update_option( self::OPTION, array_values( $saved ), false );
		return array( 'fixes' => self::states() );
	}

	public static function report() {
		return array( 'fixes' => self::states() );
	}
}
