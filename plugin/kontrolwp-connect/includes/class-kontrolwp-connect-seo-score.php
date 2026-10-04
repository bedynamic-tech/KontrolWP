<?php
/**
 * A simple on-page checklist for one post or page. It is guidance, not a
 * ranking promise: each check says what it looked at and what to try, and the
 * overall status is only "good" or "needs work". Nothing here changes a page.
 *
 * @package KontrolWP_Connect
 */

defined( 'ABSPATH' ) || exit;

class KontrolWP_Connect_SEO_Score {

	const META_KEYWORD = '_kontrolwp_seo_keyword';

	/** A description shorter than this says little; longer than the upper limit is cut off in results. */
	const DESCRIPTION_MIN = 70;
	const DESCRIPTION_MAX = 160;

	/** Pages shorter than this do not need subheadings, internal links or a readability check. */
	const HEADINGS_FROM_WORDS    = 300;
	const LINKS_FROM_WORDS       = 150;
	const READABILITY_FROM_WORDS = 100;

	/** A sentence longer than this many words is hard going. */
	const LONG_SENTENCE = 25;

	public static function register_routes( $auth ) {
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/seo/score',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'score_route' ),
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

	/* ---- Pure helpers (tested outside WordPress) ---- */

	/** A keyword phrase from untrusted input: plain text on one line, at most 80 characters. */
	public static function clean_keyword( $value ) {
		$text = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( (string) $value ) ) );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, 80 ) : substr( $text, 0, 80 );
	}

	/** Whether a phrase appears in some text, ignoring case. */
	public static function contains( $text, $phrase ) {
		if ( '' === $phrase ) {
			return false;
		}
		return function_exists( 'mb_stripos' ) ? false !== mb_stripos( $text, $phrase ) : false !== stripos( $text, $phrase );
	}

	/** The words of some HTML, as plain text. */
	public static function plain_text( $html ) {
		$html = preg_replace( '#<(script|style)\b[^>]*>.*?</\1>#is', ' ', (string) $html );
		$html = preg_replace( '/<!--.*?-->/s', ' ', $html );
		$html = preg_replace( '/<\/?(p|div|br|li|ul|ol|h[1-6]|blockquote|tr|figure|figcaption)\b[^>]*>/i', "\n", $html );
		$text = html_entity_decode( strip_tags( $html ), ENT_QUOTES, 'UTF-8' );
		return trim( preg_replace( '/[ \t]+/u', ' ', $text ) );
	}

	public static function count_words( $text ) {
		$words = preg_split( '/\s+/u', trim( $text ), -1, PREG_SPLIT_NO_EMPTY );
		return is_array( $words ) ? count( $words ) : 0;
	}

	/** The sentences of a text, each as a word count. */
	public static function sentence_lengths( $text ) {
		$parts   = preg_split( '/(?<=[.!?])\s+|\n+/u', $text, -1, PREG_SPLIT_NO_EMPTY );
		$lengths = array();
		foreach ( is_array( $parts ) ? $parts : array() as $part ) {
			$count = self::count_words( $part );
			if ( $count > 0 ) {
				$lengths[] = $count;
			}
		}
		return $lengths;
	}

	/** Links in some HTML as { internal, external }; anchors, mail and phone links are not counted. */
	public static function count_links( $html, $home_host ) {
		$internal = 0;
		$external = 0;
		if ( preg_match_all( '/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/i', (string) $html, $found, PREG_SET_ORDER ) ) {
			foreach ( $found as $match ) {
				$href = trim( html_entity_decode( '' !== $match[1] ? $match[1] : ( isset( $match[2] ) ? $match[2] : '' ), ENT_QUOTES, 'UTF-8' ) );
				if ( '' === $href || '#' === $href[0] || preg_match( '/^(mailto|tel|sms|javascript):/i', $href ) ) {
					continue;
				}
				$host = '';
				if ( 0 === strpos( $href, '//' ) ) {
					$host = (string) parse_url( 'https:' . $href, PHP_URL_HOST );
				} elseif ( preg_match( '#^https?://#i', $href ) ) {
					$host = (string) parse_url( $href, PHP_URL_HOST );
				}
				$strip = function ( $value ) {
					return preg_replace( '/^www\./', '', strtolower( $value ) );
				};
				if ( '' === $host || $strip( $host ) === $strip( (string) $home_host ) ) {
					$internal++;
				} else {
					$external++;
				}
			}
		}
		return array(
			'internal' => $internal,
			'external' => $external,
		);
	}

	/** Images in some HTML as { total, missing }: missing have no alt attribute at all. An empty alt marks decoration and counts as fine. */
	public static function count_images( $html ) {
		$total   = 0;
		$missing = 0;
		if ( preg_match_all( '/<img\b[^>]*>/i', (string) $html, $found ) ) {
			foreach ( $found[0] as $tag ) {
				$total++;
				if ( ! preg_match( '/\salt\s*=/i', $tag ) ) {
					$missing++;
				}
			}
		}
		return array(
			'total'   => $total,
			'missing' => $missing,
		);
	}

	private static function check( $id, $label, $status, $detail, $optional = false ) {
		return array(
			'id'       => $id,
			'label'    => $label,
			'status'   => $status,
			'detail'   => $detail,
			'optional' => $optional,
		);
	}

	/**
	 * The checklist. $input keys: keyword, title (the title as shown in
	 * results), description (what results would show), has_description (the
	 * page has its own), content (HTML), home_host. Each check is good,
	 * improve or skipped (when it does not apply or needs a focus keyword that
	 * is not set). The overall status is needs_work when any check that is not
	 * optional says improve, and good otherwise.
	 */
	public static function analyze( $input ) {
		$keyword = self::clean_keyword( isset( $input['keyword'] ) ? $input['keyword'] : '' );
		$title   = (string) ( isset( $input['title'] ) ? $input['title'] : '' );
		$desc    = (string) ( isset( $input['description'] ) ? $input['description'] : '' );
		$html    = (string) ( isset( $input['content'] ) ? $input['content'] : '' );
		$host    = (string) ( isset( $input['home_host'] ) ? $input['home_host'] : '' );
		$text    = self::plain_text( $html );
		$words   = self::count_words( $text );
		$checks  = array();

		// Focus keyword in the title.
		if ( '' === $keyword ) {
			$checks[] = self::check( 'keyword_title', 'Focus keyword in the title', 'skipped', 'Set a focus keyword to check this.' );
		} elseif ( self::contains( $title, $keyword ) ) {
			$checks[] = self::check( 'keyword_title', 'Focus keyword in the title', 'good', 'The title includes the focus keyword.' );
		} else {
			$checks[] = self::check( 'keyword_title', 'Focus keyword in the title', 'improve', 'The title does not include the focus keyword. Search engines and readers use the title to judge what the page is about.' );
		}

		// Description length.
		$len = function_exists( 'mb_strlen' ) ? mb_strlen( $desc ) : strlen( $desc );
		if ( 0 === $len ) {
			$checks[] = self::check( 'description_length', 'Description length', 'improve', 'There is no description, so search engines will choose their own text.' );
		} elseif ( $len < self::DESCRIPTION_MIN ) {
			$checks[] = self::check( 'description_length', 'Description length', 'improve', sprintf( 'The description is %d characters. Aim for %d to %d so it says enough.', $len, self::DESCRIPTION_MIN, self::DESCRIPTION_MAX ) );
		} elseif ( $len > self::DESCRIPTION_MAX ) {
			$checks[] = self::check( 'description_length', 'Description length', 'improve', sprintf( 'The description is %d characters and may be cut off in results. Aim for %d to %d.', $len, self::DESCRIPTION_MIN, self::DESCRIPTION_MAX ) );
		} else {
			$checks[] = self::check( 'description_length', 'Description length', 'good', sprintf( 'The description is %d characters, a good length.', $len ) );
		}

		// Subheadings.
		$headings = preg_match_all( '/<h[2-6]\b/i', $html );
		if ( $words < self::HEADINGS_FROM_WORDS ) {
			$checks[] = self::check( 'headings', 'Subheadings', 'skipped', 'A short page does not need subheadings.' );
		} elseif ( $headings > 0 ) {
			$checks[] = self::check( 'headings', 'Subheadings', 'good', sprintf( 'The page has %d subheading%s that break up the text.', $headings, 1 === $headings ? '' : 's' ) );
		} else {
			$checks[] = self::check( 'headings', 'Subheadings', 'improve', 'A long page reads better with subheadings that break it into sections.' );
		}

		// Links.
		$links = self::count_links( $html, $host );
		if ( $words < self::LINKS_FROM_WORDS ) {
			$checks[] = self::check( 'internal_links', 'Links to your other pages', 'skipped', 'A short page does not need internal links.' );
		} elseif ( $links['internal'] > 0 ) {
			$checks[] = self::check( 'internal_links', 'Links to your other pages', 'good', sprintf( 'The page links to %d of your own page%s.', $links['internal'], 1 === $links['internal'] ? '' : 's' ) );
		} else {
			$checks[] = self::check( 'internal_links', 'Links to your other pages', 'improve', 'Link to a related page on your site, which helps readers and search engines find it.' );
		}
		if ( $words < self::LINKS_FROM_WORDS ) {
			$checks[] = self::check( 'external_links', 'Links to other sites', 'skipped', 'A short page does not need outside links.', true );
		} elseif ( $links['external'] > 0 ) {
			$checks[] = self::check( 'external_links', 'Links to other sites', 'good', sprintf( 'The page links to %d other site%s.', $links['external'], 1 === $links['external'] ? '' : 's' ), true );
		} else {
			$checks[] = self::check( 'external_links', 'Links to other sites', 'improve', 'A link to a trusted source can help readers. This is optional and does not affect the overall status.', true );
		}

		// Image alt text.
		$images = self::count_images( $html );
		if ( 0 === $images['total'] ) {
			$checks[] = self::check( 'image_alt', 'Image alt text', 'skipped', 'The page has no images in its content.' );
		} elseif ( 0 === $images['missing'] ) {
			$checks[] = self::check( 'image_alt', 'Image alt text', 'good', 'Every image has alt text, or is marked as decoration.' );
		} else {
			$checks[] = self::check( 'image_alt', 'Image alt text', 'improve', sprintf( '%d of %d image%s have no alt text. Alt text helps people using screen readers and tells search engines what the image shows.', $images['missing'], $images['total'], 1 === $images['total'] ? '' : 's' ) );
		}

		// Readability: sentence length is a plain proxy that does not depend on the language's word lists.
		if ( $words < self::READABILITY_FROM_WORDS ) {
			$checks[] = self::check( 'readability', 'Readability', 'skipped', 'There is not enough text to judge.' );
		} else {
			$lengths = self::sentence_lengths( $text );
			$count   = max( 1, count( $lengths ) );
			$average = array_sum( $lengths ) / $count;
			$long    = count( array_filter( $lengths, function ( $n ) {
				return $n > self::LONG_SENTENCE;
			} ) ) / $count;
			if ( $average > 20 || $long > 0.25 ) {
				$checks[] = self::check( 'readability', 'Readability', 'improve', sprintf( 'Sentences average %d words and %d%% are over %d words. Shorter sentences are easier to read.', round( $average ), round( $long * 100 ), self::LONG_SENTENCE ) );
			} else {
				$checks[] = self::check( 'readability', 'Readability', 'good', sprintf( 'Sentences average %d words, which is easy to follow.', round( $average ) ) );
			}
		}

		$needs = false;
		foreach ( $checks as $item ) {
			if ( 'improve' === $item['status'] && ! $item['optional'] ) {
				$needs = true;
			}
		}
		return array(
			'keyword' => $keyword,
			'status'  => $needs ? 'needs_work' : 'good',
			'checks'  => $checks,
		);
	}

	/* ---- WordPress glue ---- */

	/** The checklist for one post, using the title, description and keyword in the request when it has them, so the dashboard can show a draft before it is saved. */
	public static function score_route( $request ) {
		$post = get_post( (int) $request->get_param( 'id' ) );
		if ( ! $post ) {
			return new WP_Error( 'kontrolwp_not_found', 'That page no longer exists.', array( 'status' => 404 ) );
		}
		return self::for_post( $post, $request->get_json_params() );
	}

	/** The checklist for a post. $draft may carry seo_title, description and keyword, which stand in for the saved values. */
	public static function for_post( $post, $draft = array() ) {
		$draft   = is_array( $draft ) ? $draft : array();
		$pick    = function ( $key, $meta ) use ( $draft, $post ) {
			return isset( $draft[ $key ] ) && is_string( $draft[ $key ] ) ? $draft[ $key ] : (string) get_post_meta( $post->ID, $meta, true );
		};
		$keyword = $pick( 'keyword', self::META_KEYWORD );
		$custom  = $pick( 'seo_title', KontrolWP_Connect_SEO::META_TITLE );
		$desc    = $pick( 'description', KontrolWP_Connect_SEO::META_DESCRIPTION );
		$title   = '' !== $custom ? $custom : html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' );
		if ( '' === $desc ) {
			$source = '' !== trim( (string) $post->post_excerpt ) ? $post->post_excerpt : $post->post_content;
			$desc   = '';
			// An automatic description is real text in results, so it counts; the check only complains when there is none.
			$desc = KontrolWP_Connect_SEO::trim_description( $source );
		}
		return self::analyze(
			array(
				'keyword'     => $keyword,
				'title'       => $title,
				'description' => $desc,
				'content'     => strip_shortcodes( (string) $post->post_content ),
				'home_host'   => (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			)
		);
	}
}
