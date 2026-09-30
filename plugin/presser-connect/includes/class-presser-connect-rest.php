<?php
/**
 * The REST routes the Presser dashboard calls. Every route requires a
 * signature from Presser_Connect_Auth; none are reachable by site visitors.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Rest {

	const NAMESPACE_V1 = 'presser/v1';

	public static function register_routes() {
		$auth = array( 'Presser_Connect_Auth', 'verify' );

		register_rest_route(
			self::NAMESPACE_V1,
			'/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'status' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NAMESPACE_V1,
			'/updates',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'updates' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NAMESPACE_V1,
			'/updates/apply',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'apply_update' ),
				'permission_callback' => $auth,
				'args'                => array(
					'kind'    => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'core', 'plugin', 'theme' ),
					),
					'slug'    => array(
						'required' => true,
						'type'     => 'string',
					),
					// For core: the version the dashboard showed, so the site
					// never installs something the owner did not see.
					'version' => array(
						'type' => 'string',
					),
				),
			)
		);
		register_rest_route(
			self::NAMESPACE_V1,
			'/comments',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'comments' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NAMESPACE_V1,
			'/comments/moderate',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'moderate_comment' ),
				'permission_callback' => $auth,
				'args'                => array(
					'id'     => array(
						'required' => true,
						'type'     => 'integer',
						'minimum'  => 1,
					),
					'action' => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'approve', 'spam', 'trash' ),
					),
				),
			)
		);
	}

	public static function status() {
		return array(
			'name'           => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
			'home_url'       => home_url( '/' ),
			'wp_version'     => get_bloginfo( 'version' ),
			'php_version'    => PHP_VERSION,
			'plugin_version' => PRESSER_CONNECT_VERSION,
			'theme'          => wp_get_theme()->get( 'Name' ),
			'icon_url'       => get_site_icon_url( 128 ),
		);
	}

	public static function updates() {
		self::load_admin_includes();

		// WordPress checks on its own twice a day. Refresh only stale data so
		// frequent dashboard syncs never hammer api.wordpress.org.
		$core = get_site_transient( 'update_core' );
		if ( ! is_object( $core ) || empty( $core->last_checked ) || time() - $core->last_checked > 12 * HOUR_IN_SECONDS ) {
			wp_version_check();
		}
		wp_update_plugins();
		wp_update_themes();

		$core_update = null;
		foreach ( (array) get_core_updates() as $offer ) {
			if ( is_object( $offer ) && isset( $offer->response ) && 'upgrade' === $offer->response ) {
				$core_update = array(
					'current'     => get_bloginfo( 'version' ),
					'new_version' => $offer->current,
				);
				break;
			}
		}

		$plugins = array();
		foreach ( get_plugin_updates() as $file => $data ) {
			$plugins[] = array(
				'slug'            => $file,
				'name'            => $data->Name,
				'current_version' => $data->Version,
				'new_version'     => isset( $data->update->new_version ) ? $data->update->new_version : '',
			);
		}

		$themes = array();
		foreach ( get_theme_updates() as $stylesheet => $theme ) {
			$themes[] = array(
				'slug'            => $stylesheet,
				'name'            => $theme->get( 'Name' ),
				'current_version' => $theme->get( 'Version' ),
				'new_version'     => isset( $theme->update['new_version'] ) ? $theme->update['new_version'] : '',
			);
		}

		return array(
			'core'    => $core_update,
			'plugins' => $plugins,
			'themes'  => $themes,
		);
	}

	/**
	 * Update WordPress core, one plugin or one theme, the same way the
	 * Updates screen does.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function apply_update( $request ) {
		$kind = $request['kind'];
		$slug = (string) $request['slug'];

		$context = 'core' === $kind ? 'capability_update_core' : 'presser_connect_update';
		if ( ! wp_is_file_mod_allowed( $context ) ) {
			return new WP_Error( 'presser_file_mods_disabled', __( 'File changes are disabled on this site (DISALLOW_FILE_MODS).', 'presser-connect' ), array( 'status' => 409 ) );
		}
		self::load_admin_includes();
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';

		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}

		if ( 'core' === $kind ) {
			return self::apply_core_update( (string) $request['version'] );
		}

		if ( 'plugin' === $kind ) {
			if ( ! array_key_exists( $slug, get_plugins() ) ) {
				return new WP_Error( 'presser_not_found', __( 'That plugin is not installed.', 'presser-connect' ), array( 'status' => 404 ) );
			}
			wp_update_plugins();
		} else {
			if ( ! wp_get_theme( $slug )->exists() ) {
				return new WP_Error( 'presser_not_found', __( 'That theme is not installed.', 'presser-connect' ), array( 'status' => 404 ) );
			}
			wp_update_themes();
		}

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = 'plugin' === $kind ? new Plugin_Upgrader( $skin ) : new Theme_Upgrader( $skin );
		ob_start();
		$results = $upgrader->bulk_upgrade( array( $slug ) );
		ob_end_clean();

		if ( $skin->get_errors()->has_errors() ) {
			return new WP_Error( 'presser_update_failed', implode( ' ', $skin->get_error_messages() ), array( 'status' => 500 ) );
		}
		if ( false === $results ) {
			return self::filesystem_error();
		}
		$result = isset( $results[ $slug ] ) ? $results[ $slug ] : null;
		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'presser_update_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( ! $result ) {
			return new WP_Error( 'presser_update_failed', __( 'The update did not complete.', 'presser-connect' ), array( 'status' => 500 ) );
		}
		return array( 'ok' => true );
	}

	/**
	 * Install the offered core version. Core_Upgrader puts the site in
	 * maintenance mode, replaces the files and runs the database upgrade.
	 */
	private static function apply_core_update( $version ) {
		wp_version_check( array(), true );

		$offer = null;
		foreach ( (array) get_core_updates() as $candidate ) {
			if ( is_object( $candidate ) && isset( $candidate->response ) && 'upgrade' === $candidate->response ) {
				$offer = $candidate;
				break;
			}
		}
		if ( ! $offer ) {
			return new WP_Error( 'presser_up_to_date', __( 'WordPress is already up to date.', 'presser-connect' ), array( 'status' => 409 ) );
		}
		if ( '' !== $version && $offer->current !== $version ) {
			return new WP_Error(
				'presser_version_changed',
				/* translators: %s: WordPress version now offered */
				sprintf( __( 'WordPress now offers version %s. Sync the site and try again.', 'presser-connect' ), $offer->current ),
				array( 'status' => 409 )
			);
		}

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = new Core_Upgrader( $skin );
		ob_start();
		$result = $upgrader->upgrade( $offer, array( 'allow_relaxed_file_ownership' => true ) );
		ob_end_clean();

		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'presser_update_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( $skin->get_errors()->has_errors() ) {
			return new WP_Error( 'presser_update_failed', implode( ' ', $skin->get_error_messages() ), array( 'status' => 500 ) );
		}
		if ( ! $result ) {
			return self::filesystem_error();
		}
		return array(
			'ok'      => true,
			'version' => $result,
		);
	}

	private static function filesystem_error() {
		return new WP_Error( 'presser_update_failed', __( 'WordPress could not write to its files. Check file permissions or FS_METHOD.', 'presser-connect' ), array( 'status' => 500 ) );
	}

	public static function comments() {
		$counts   = wp_count_comments();
		$comments = get_comments(
			array(
				'status'  => 'hold',
				'number'  => 50,
				'orderby' => 'comment_date_gmt',
				'order'   => 'DESC',
			)
		);

		$items = array();
		foreach ( $comments as $comment ) {
			$content = trim( wp_strip_all_tags( $comment->comment_content ) );
			$items[] = array(
				'id'           => (int) $comment->comment_ID,
				'author'       => $comment->comment_author,
				'author_email' => $comment->comment_author_email,
				'content'      => function_exists( 'mb_substr' ) ? mb_substr( $content, 0, 1000 ) : substr( $content, 0, 1000 ),
				'post_title'   => html_entity_decode( wp_strip_all_tags( get_the_title( $comment->comment_post_ID ) ), ENT_QUOTES, 'UTF-8' ),
				'post_url'     => (string) get_permalink( $comment->comment_post_ID ),
				'date_gmt'     => $comment->comment_date_gmt,
			);
		}

		return array(
			'pending_count' => (int) $counts->moderated,
			'comments'      => $items,
		);
	}

	/**
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function moderate_comment( $request ) {
		$comment = get_comment( (int) $request['id'] );
		if ( ! $comment ) {
			return new WP_Error( 'presser_not_found', __( 'That comment no longer exists.', 'presser-connect' ), array( 'status' => 404 ) );
		}
		switch ( $request['action'] ) {
			case 'approve':
				$done = wp_set_comment_status( $comment, 'approve' );
				break;
			case 'spam':
				$done = wp_spam_comment( $comment );
				break;
			default:
				$done = wp_trash_comment( $comment );
		}
		if ( is_wp_error( $done ) || ! $done ) {
			return new WP_Error( 'presser_moderation_failed', __( 'WordPress could not update that comment.', 'presser-connect' ), array( 'status' => 500 ) );
		}
		return array( 'ok' => true );
	}

	private static function load_admin_includes() {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/theme.php';
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
}
