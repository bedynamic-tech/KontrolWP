<?php
/**
 * Maintenance mode (0.34.0): while the dashboard has it on, visitors see a
 * simple "back soon" page instead of the site, branded with the site's logo
 * (or the login page logo uploaded from the dashboard) and the owner's colors,
 * sent as 503 Service Unavailable with Retry-After so search engines come back
 * later instead of indexing it.
 *
 * Signed-in users who can edit posts still see the site, with a notice in the
 * admin bar. wp-admin, the login page, the REST API (so the dashboard keeps
 * working), cron and robots.txt are never touched. Everything lives in one
 * option, so turning it off or deactivating the plugin brings the site back at once.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Maintenance {

	/**
	 * Holds array( 'enabled' => bool, 'headline' => string, 'message' => string, 'since' => int,
	 * 'logo' => 'site'|'login'|'none', 'background' => '#rrggbb'|'', 'accent' => '#rrggbb'|'' ).
	 * An empty color follows the visitor's light or dark setting.
	 */
	const OPTION = 'kontrolwp_connect_maintenance';

	/** Shows the page while maintenance mode is off, so the owner can see it first. */
	const PREVIEW = 'kontrolwp-maintenance-preview';

	const DEFAULT_HEADLINE = 'We will be back soon';
	const DEFAULT_MESSAGE  = 'This site is down for scheduled maintenance. Please check back shortly.';

	const MAX_HEADLINE = 120;
	const MAX_MESSAGE  = 1000;

	const LOGOS = array( 'site', 'login', 'none' );

	/** Seconds a visitor or crawler is asked to wait before trying again. */
	const RETRY_AFTER = 3600;

	public static function boot() {
		add_action( 'template_redirect', array( __CLASS__, 'serve' ), 0 );
		add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar' ), 100 );
	}

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/maintenance'      => 'report_route',
			'/maintenance/save' => 'save_route',
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

	/** The saved setting with every field present and clean. */
	public static function clean( $stored ) {
		$stored = is_array( $stored ) ? $stored : array();
		return array(
			'enabled'    => ! empty( $stored['enabled'] ),
			'headline'   => isset( $stored['headline'] ) && is_string( $stored['headline'] ) ? self::trim_text( $stored['headline'], self::MAX_HEADLINE, false ) : '',
			'message'    => isset( $stored['message'] ) && is_string( $stored['message'] ) ? self::trim_text( $stored['message'], self::MAX_MESSAGE, true ) : '',
			'since'      => isset( $stored['since'] ) ? max( 0, (int) $stored['since'] ) : 0,
			'logo'       => isset( $stored['logo'] ) && in_array( $stored['logo'], self::LOGOS, true ) ? $stored['logo'] : 'site',
			'background' => self::color( isset( $stored['background'] ) ? $stored['background'] : '' ),
			'accent'     => self::color( isset( $stored['accent'] ) ? $stored['accent'] : '' ),
		);
	}

	/** A #rrggbb color in lower case, or '' for anything else. */
	public static function color( $value ) {
		return is_string( $value ) && preg_match( '/^#[0-9a-f]{6}$/i', $value ) ? strtolower( $value ) : '';
	}

	/** Plain text, without control characters, cut to $max characters. Line breaks survive only when $lines. */
	public static function trim_text( $text, $max, $lines ) {
		$text = str_replace( array( "\r\n", "\r" ), "\n", (string) $text );
		$text = preg_replace( $lines ? '/[^\P{C}\n]+/u' : '/\p{C}+/u', $lines ? '' : ' ', $text );
		$text = $lines ? preg_replace( "/\n{3,}/", "\n\n", $text ) : preg_replace( '/\s+/u', ' ', $text );
		$text = trim( (string) $text );
		return function_exists( 'mb_substr' ) ? mb_substr( $text, 0, $max ) : substr( $text, 0, $max );
	}

	/**
	 * Whether this request gets the maintenance page: maintenance is on (or a preview
	 * was asked for), the visitor cannot edit the site, and it is not robots.txt.
	 */
	public static function applies( $settings, $preview, $can_edit, $is_robots ) {
		if ( $is_robots ) {
			return false;
		}
		if ( $preview ) {
			return true;
		}
		return ! empty( $settings['enabled'] ) && ! $can_edit;
	}

	/** The maintenance page's HTML. $logo is array( url, width, height ) with '' as the url when there is none. */
	public static function page( $settings, $site_name, $logo, $lang ) {
		$esc      = function ( $text ) {
			return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
		};
		$headline = '' !== $settings['headline'] ? $settings['headline'] : self::DEFAULT_HEADLINE;
		$message  = '' !== $settings['message'] ? $settings['message'] : self::DEFAULT_MESSAGE;
		$name     = trim( (string) $site_name );
		$title    = '' !== $name ? $headline . ' | ' . $name : $headline;
		$mark     = '';
		if ( '' !== $logo[0] ) {
			$mark = '<img class="logo" src="' . $esc( $logo[0] ) . '" alt="' . $esc( $name ) . '">';
		} elseif ( '' !== $name ) {
			$mark = '<p class="name">' . $esc( $name ) . '</p>';
		}
		// The owner's colors: the page behind the card, and a bar along the card's top edge.
		// The card itself keeps following light or dark, so its text always stays readable.
		$brand = '';
		if ( '' !== $settings['background'] ) {
			$brand .= 'body{background:' . $settings['background'] . '}';
		}
		if ( '' !== $settings['accent'] ) {
			$brand .= 'main{border-top:6px solid ' . $settings['accent'] . '}';
		}
		$paragraphs = '';
		foreach ( preg_split( "/\n{2,}/", $message ) as $paragraph ) {
			$paragraphs .= '<p>' . nl2br( $esc( $paragraph ), false ) . '</p>';
		}
		return '<!doctype html><html lang="' . $esc( $lang ? $lang : 'en' ) . '"><head><meta charset="utf-8">'
			. '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">'
			. '<title>' . $esc( $title ) . '</title><style>'
			. ':root{color-scheme:light dark;--bg:#f6f6f7;--card:#fff;--text:#18181b;--muted:#52525b;--line:#e4e4e7}'
			. '@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--text:#fafafa;--muted:#a1a1aa;--line:#27272a}}'
			. '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;'
			. 'background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
			. 'main{width:100%;max-width:480px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:40px 32px;text-align:center}'
			. '.logo{display:block;max-width:200px;max-height:80px;margin:0 auto 28px;object-fit:contain}'
			. '.name{margin:0 0 24px;font-weight:600;color:var(--muted)}'
			. 'h1{margin:0 0 12px;font-size:1.6rem;line-height:1.25;font-weight:650;letter-spacing:-.01em}'
			. 'main p{margin:0 0 12px;color:var(--muted)}main p:last-child{margin-bottom:0}'
			. $brand . '</style></head><body><main>' . $mark . '<h1>' . $esc( $headline ) . '</h1>' . $paragraphs . '</main></body></html>';
	}

	/* ---- WordPress ---- */

	public static function settings() {
		return self::clean( get_option( self::OPTION, array() ) );
	}

	/** The login page logo uploaded from the dashboard: array( url, width, height ), '' as the url when there is none. */
	private static function login_logo() {
		return KontrolWP_Connect_Login_Logo::uploaded( KontrolWP_Connect_Login_Logo::settings() );
	}

	/** The logo shown on the page, for the chosen source: array( url, width, height ). */
	private static function logo( $settings ) {
		if ( 'none' === $settings['logo'] ) {
			return array( '', 0, 0 );
		}
		if ( 'login' === $settings['logo'] ) {
			$login = self::login_logo();
			if ( '' !== $login[0] ) {
				return $login;
			}
		}
		// The site's logo, or its site icon, as the login logo uses; also the fallback when the upload is gone.
		return array_slice( KontrolWP_Connect_Login_Logo::site_logo(), 0, 3 );
	}

	public static function serve() {
		$settings = self::settings();
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a preview only shows the page.
		$preview  = isset( $_GET[ self::PREVIEW ] );
		$can_edit = is_user_logged_in() && current_user_can( 'edit_posts' );
		if ( ! self::applies( $settings, $preview, $can_edit, is_robots() ) ) {
			return;
		}
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		nocache_headers();
		if ( ! $preview ) {
			status_header( 503 );
			header( 'Retry-After: ' . self::RETRY_AFTER );
		}
		header( 'Content-Type: text/html; charset=utf-8' );
		header( 'X-Robots-Tag: noindex' );
		echo self::page( $settings, get_bloginfo( 'name' ), self::logo( $settings ), get_bloginfo( 'language' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in page().
		exit;
	}

	/** Reminds a signed-in editor, who still sees the site, that visitors do not. */
	public static function admin_bar( $bar ) {
		if ( ! self::settings()['enabled'] || ! current_user_can( 'edit_posts' ) ) {
			return;
		}
		$bar->add_node(
			array(
				'id'    => 'kontrolwp-maintenance',
				'title' => '<span style="display:inline-block;padding:0 8px;border-radius:3px;background:#b45309;color:#fff">Maintenance mode is on</span>',
				'href'  => add_query_arg( self::PREVIEW, '1', home_url( '/' ) ),
				'meta'  => array( 'title' => 'Visitors see the maintenance page. Turn it off in KontrolWP.' ),
			)
		);
	}

	/** Empties the common page caches, so visitors get the change instead of a stored copy. */
	private static function flush_caches() {
		if ( function_exists( 'wp_cache_clear_cache' ) ) {
			wp_cache_clear_cache(); // WP Super Cache.
		}
		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain(); // WP Rocket.
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all(); // W3 Total Cache.
		}
		do_action( 'litespeed_purge_all' ); // LiteSpeed Cache.
		do_action( 'breeze_clear_all_cache' ); // Breeze.
		if ( class_exists( 'WpFastestCache' ) ) {
			do_action( 'wpfc_clear_all_cache' ); // WP Fastest Cache.
		}
		if ( function_exists( 'sg_cachepress_purge_cache' ) ) {
			sg_cachepress_purge_cache(); // SiteGround Optimizer.
		}
	}

	public static function report() {
		$settings = self::settings();
		return array(
			'enabled'          => $settings['enabled'],
			'headline'         => $settings['headline'],
			'message'          => $settings['message'],
			'logo'             => $settings['logo'],
			'background'       => $settings['background'],
			'accent'           => $settings['accent'],
			'since'            => $settings['since'] ? gmdate( 'c', $settings['since'] ) : null,
			'default_headline' => self::DEFAULT_HEADLINE,
			'default_message'  => self::DEFAULT_MESSAGE,
			'site_logo_url'    => KontrolWP_Connect_Login_Logo::site_logo()[0],
			'login_logo_url'   => self::login_logo()[0],
			'preview_url'      => add_query_arg( self::PREVIEW, '1', home_url( '/' ) ),
		);
	}

	public static function report_route() {
		return self::report();
	}

	public static function save_route( $request ) {
		$body = $request->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['enabled'] ) || ! is_bool( $body['enabled'] ) ) {
			return new WP_Error( 'kontrolwp_invalid_maintenance', 'Send enabled as true or false.', array( 'status' => 400 ) );
		}
		if ( isset( $body['logo'] ) && ! in_array( $body['logo'], self::LOGOS, true ) ) {
			return new WP_Error( 'kontrolwp_invalid_maintenance', 'Send logo as site, login or none.', array( 'status' => 400 ) );
		}
		foreach ( array( 'background', 'accent' ) as $field ) {
			if ( isset( $body[ $field ] ) && '' !== $body[ $field ] && '' === self::color( $body[ $field ] ) ) {
				return new WP_Error( 'kontrolwp_invalid_maintenance', "Send $field as a #rrggbb color, or empty for the default.", array( 'status' => 400 ) );
			}
		}
		foreach ( array( 'headline', 'message' ) as $field ) {
			if ( isset( $body[ $field ] ) && ! is_string( $body[ $field ] ) ) {
				return new WP_Error( 'kontrolwp_invalid_maintenance', "Send $field as text.", array( 'status' => 400 ) );
			}
		}
		$current = self::settings();
		$next    = self::clean(
			array(
				'enabled'    => $body['enabled'],
				'headline'   => isset( $body['headline'] ) ? $body['headline'] : $current['headline'],
				'message'    => isset( $body['message'] ) ? $body['message'] : $current['message'],
				'logo'       => isset( $body['logo'] ) ? $body['logo'] : $current['logo'],
				'background' => isset( $body['background'] ) ? $body['background'] : $current['background'],
				'accent'     => isset( $body['accent'] ) ? $body['accent'] : $current['accent'],
				// Keeps when it was turned on while it stays on.
				'since'      => $body['enabled'] ? ( $current['enabled'] && $current['since'] ? $current['since'] : time() ) : 0,
			)
		);
		update_option( self::OPTION, $next, true );
		if ( $next['enabled'] !== $current['enabled'] ) {
			self::flush_caches();
		}
		return self::report();
	}
}
