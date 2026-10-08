<?php
/**
 * The REST routes the KontrolWP dashboard calls. Every route requires a
 * signature from KontrolWP_Connect_Auth; none are reachable by site visitors.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Rest {

	const NAMESPACE_V1 = 'kontrolwp/v1';

	public static function register_routes() {
		$auth = array( 'KontrolWP_Connect_Auth', 'verify' );
		add_filter( 'rest_post_dispatch', array( __CLASS__, 'no_store' ), 10, 3 );

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
			'/self-update',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'self_update' ),
				'permission_callback' => $auth,
				'args'                => array(
					'version' => array(
						'required' => true,
						'type'     => 'string',
					),
					// Base64 of the plugin zip, built by the dashboard.
					'package' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
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
		KontrolWP_Connect_Plugins::register_routes( $auth );
		KontrolWP_Connect_Users::register_routes( $auth );
		KontrolWP_Connect_Links::register_routes( $auth );
		KontrolWP_Connect_Content::register_routes( $auth );
		KontrolWP_Connect_Security::register_routes( $auth );
		KontrolWP_Connect_Accessibility::register_routes( $auth );
		KontrolWP_Connect_SEO::register_routes( $auth );
		KontrolWP_Connect_Redirects::register_routes( $auth );
		KontrolWP_Connect_Migrate::register_routes( $auth );
		KontrolWP_Connect_SEO_Tools::register_routes( $auth );
		KontrolWP_Connect_SEO_Content::register_routes( $auth );
		KontrolWP_Connect_SEO_Score::register_routes( $auth );
		KontrolWP_Connect_Snippets::register_routes( $auth );
		register_rest_route(
			self::NAMESPACE_V1,
			'/admins',
			array(
				'methods'             => 'GET',
				'callback'            => array( 'KontrolWP_Connect_Login', 'admins' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			self::NAMESPACE_V1,
			'/login',
			array(
				'methods'             => 'POST',
				'callback'            => array( 'KontrolWP_Connect_Login', 'create' ),
				'permission_callback' => $auth,
				'args'                => array(
					'user_id' => array(
						'required' => true,
						'type'     => 'integer',
						'minimum'  => 1,
					),
					'post_id' => array(
						'type'    => 'integer',
						'minimum' => 0,
						'default' => 0,
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
			'name'             => html_entity_decode( get_bloginfo( 'name' ), ENT_QUOTES, 'UTF-8' ),
			'home_url'         => home_url( '/' ),
			'wp_version'       => get_bloginfo( 'version' ),
			'php_version'      => PHP_VERSION,
			'plugin_version'   => KONTROLWP_CONNECT_VERSION,
			'theme'            => wp_get_theme()->get( 'Name' ),
			'icon_url'         => get_site_icon_url( 128 ),
			'core_auto_update' => KontrolWP_Connect_Plugins::core_auto_update(),
		);
	}

	public static function updates() {
		self::load_admin_includes();

		// WordPress checks on its own twice a day. Refresh only stale data so
		// frequent dashboard syncs never hammer api.wordpress.org; data checked
		// against another version (before a core update) is stale too.
		$installed = get_bloginfo( 'version' );
		$core      = get_site_transient( 'update_core' );
		if ( ! is_object( $core ) || empty( $core->last_checked ) || time() - $core->last_checked > 12 * HOUR_IN_SECONDS
			|| ! isset( $core->version_checked ) || $core->version_checked !== $installed ) {
			wp_version_check( array(), true );
		}
		wp_update_plugins();
		wp_update_themes();

		$core_update = null;
		foreach ( (array) get_core_updates() as $offer ) {
			if ( is_object( $offer ) && isset( $offer->response ) && 'upgrade' === $offer->response
				&& isset( $offer->current ) && version_compare( $offer->current, $installed, '>' ) ) {
				$core_update = array(
					'current'     => $installed,
					'new_version' => $offer->current,
					'icon_url'    => includes_url( 'images/w-logo-blue.png' ),
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
				'icon_url'        => self::plugin_icon( isset( $data->update->icons ) ? $data->update->icons : array() ),
			);
		}

		$themes = array();
		foreach ( get_theme_updates() as $stylesheet => $theme ) {
			$themes[] = array(
				'slug'            => $stylesheet,
				'name'            => $theme->get( 'Name' ),
				'current_version' => $theme->get( 'Version' ),
				'new_version'     => isset( $theme->update['new_version'] ) ? $theme->update['new_version'] : '',
				'icon_url'        => (string) $theme->get_screenshot(),
			);
		}

		return array(
			'core'    => $core_update,
			'plugins' => $plugins,
			'themes'  => $themes,
		);
	}

	/**
	 * The plugin's icon from its update source: WordPress.org, or whatever
	 * a commercial plugin's updater reports in the same format.
	 *
	 * @param array|object $icons Icon URLs keyed by svg, 2x, 1x or default.
	 */
	public static function plugin_icon( $icons ) {
		$icons = (array) $icons;
		foreach ( array( 'svg', '2x', '1x', 'default' ) as $size ) {
			if ( ! empty( $icons[ $size ] ) && is_string( $icons[ $size ] ) ) {
				return $icons[ $size ];
			}
		}
		return '';
	}

	/**
	 * Tell page caches and CDNs never to keep KontrolWP's answers, so the
	 * dashboard always sees the site as it is now.
	 *
	 * @param WP_REST_Response $response Outgoing response.
	 * @param WP_REST_Server   $server   REST server.
	 * @param WP_REST_Request  $request  Incoming request.
	 */
	public static function no_store( $response, $server, $request ) {
		if ( 0 === strpos( $request->get_route(), '/' . self::NAMESPACE_V1 . '/' ) && $response instanceof WP_REST_Response ) {
			$response->header( 'Cache-Control', 'no-store, private, max-age=0' );
		}
		return $response;
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

		$context = 'core' === $kind ? 'capability_update_core' : 'kontrolwp_connect_update';
		if ( ! wp_is_file_mod_allowed( $context ) ) {
			return new WP_Error( 'kontrolwp_file_mods_disabled', __( 'File changes are disabled on this site (DISALLOW_FILE_MODS).', 'kontrolwp-connect' ), array( 'status' => 409 ) );
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
				return new WP_Error( 'kontrolwp_not_found', __( 'That plugin is not installed.', 'kontrolwp-connect' ), array( 'status' => 404 ) );
			}
			wp_update_plugins();
		} else {
			if ( ! wp_get_theme( $slug )->exists() ) {
				return new WP_Error( 'kontrolwp_not_found', __( 'That theme is not installed.', 'kontrolwp-connect' ), array( 'status' => 404 ) );
			}
			wp_update_themes();
		}

		return self::bulk_upgrade( $kind, $slug );
	}

	/**
	 * Run the Updates screen's upgrader for one plugin or theme that
	 * WordPress lists as having an update.
	 *
	 * @param string $kind plugin or theme.
	 * @param string $slug Plugin file or theme stylesheet.
	 */
	private static function bulk_upgrade( $kind, $slug ) {
		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = 'plugin' === $kind ? new Plugin_Upgrader( $skin ) : new Theme_Upgrader( $skin );
		ob_start();
		$results = $upgrader->bulk_upgrade( array( $slug ) );
		ob_end_clean();

		if ( $skin->get_errors()->has_errors() ) {
			return new WP_Error( 'kontrolwp_update_failed', $skin->get_error_messages(), array( 'status' => 500 ) );
		}
		if ( false === $results ) {
			return self::filesystem_error();
		}
		$result = isset( $results[ $slug ] ) ? $results[ $slug ] : null;
		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'kontrolwp_update_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( ! $result ) {
			return new WP_Error( 'kontrolwp_update_failed', __( 'The update did not complete.', 'kontrolwp-connect' ), array( 'status' => 500 ) );
		}
		return array( 'ok' => true );
	}

	/**
	 * Update KontrolWP Connect itself with the package the dashboard sent. The
	 * dashboard sits behind Cloudflare Access, so WordPress cannot download
	 * from it; the signed request carries the zip instead, and its signature
	 * covers every byte. The package is then offered to WordPress as a normal
	 * plugin update and installed by the same upgrader as any other plugin.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function self_update( $request ) {
		if ( ! wp_is_file_mod_allowed( 'kontrolwp_connect_update' ) ) {
			return new WP_Error( 'kontrolwp_file_mods_disabled', __( 'File changes are disabled on this site (DISALLOW_FILE_MODS).', 'kontrolwp-connect' ), array( 'status' => 409 ) );
		}
		$version = (string) $request['version'];
		if ( version_compare( $version, KONTROLWP_CONNECT_VERSION, '<=' ) ) {
			return new WP_Error( 'kontrolwp_up_to_date', __( 'KontrolWP Connect is already up to date.', 'kontrolwp-connect' ), array( 'status' => 409 ) );
		}
		$package = base64_decode( (string) $request['package'], true );
		if ( false === $package || 'PK' !== substr( $package, 0, 2 ) ) {
			return new WP_Error( 'kontrolwp_bad_package', __( 'The update package is not a zip file.', 'kontrolwp-connect' ), array( 'status' => 400 ) );
		}

		self::load_admin_includes();
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}

		$file = wp_tempnam( 'kontrolwp-connect.zip' );
		if ( ! $file || false === file_put_contents( $file, $package ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
			return self::filesystem_error();
		}

		// WordPress downloads a package given as a local path by using it as is.
		$basename = plugin_basename( KONTROLWP_CONNECT_FILE );
		$updates  = get_site_transient( 'update_plugins' );
		if ( ! is_object( $updates ) ) {
			$updates = new stdClass();
		}
		if ( ! isset( $updates->response ) || ! is_array( $updates->response ) ) {
			$updates->response = array();
		}
		$updates->response[ $basename ] = (object) array(
			'slug'        => 'kontrolwp-connect',
			'plugin'      => $basename,
			'new_version' => $version,
			'package'     => $file,
		);
		set_site_transient( 'update_plugins', $updates );

		// Keep the plugin in its current folder even if it was installed
		// under another name than the zip uses.
		$folder = dirname( $basename );
		$rename = static function ( $source, $remote_source ) use ( $folder ) {
			global $wp_filesystem;
			$wanted = trailingslashit( $remote_source ) . $folder . '/';
			if ( untrailingslashit( $source ) === untrailingslashit( $wanted ) || ! $wp_filesystem ) {
				return $source;
			}
			return $wp_filesystem->move( $source, $wanted ) ? $wanted : $source;
		};
		add_filter( 'upgrader_source_selection', $rename, 10, 2 );
		$result = self::bulk_upgrade( 'plugin', $basename );
		remove_filter( 'upgrader_source_selection', $rename, 10 );
		if ( file_exists( $file ) ) {
			wp_delete_file( $file );
		}
		return $result;
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
			return new WP_Error( 'kontrolwp_up_to_date', __( 'WordPress is already up to date.', 'kontrolwp-connect' ), array( 'status' => 409 ) );
		}
		if ( '' !== $version && $offer->current !== $version ) {
			return new WP_Error(
				'kontrolwp_version_changed',
				/* translators: %s: WordPress version now offered */
				sprintf( __( 'WordPress now offers version %s. Sync the site and try again.', 'kontrolwp-connect' ), $offer->current ),
				array( 'status' => 409 )
			);
		}

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = new Core_Upgrader( $skin );
		ob_start();
		$result = $upgrader->upgrade( $offer, array( 'allow_relaxed_file_ownership' => true ) );
		ob_end_clean();

		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'kontrolwp_update_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( $skin->get_errors()->has_errors() ) {
			return new WP_Error( 'kontrolwp_update_failed', $skin->get_error_messages(), array( 'status' => 500 ) );
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
		return new WP_Error( 'kontrolwp_update_failed', __( 'WordPress could not write to its files. Check file permissions or FS_METHOD.', 'kontrolwp-connect' ), array( 'status' => 500 ) );
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
			return new WP_Error( 'kontrolwp_not_found', __( 'That comment no longer exists.', 'kontrolwp-connect' ), array( 'status' => 404 ) );
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
			return new WP_Error( 'kontrolwp_moderation_failed', __( 'WordPress could not update that comment.', 'kontrolwp-connect' ), array( 'status' => 500 ) );
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
