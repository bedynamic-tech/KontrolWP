<?php
/**
 * Plugin management for the dashboard: list installed plugins, activate,
 * deactivate or delete one, and install new ones from WordPress.org, a URL
 * or an uploaded zip. Everything goes through WordPress's own functions and
 * Plugin_Upgrader, as the Plugins screen does. Presser Connect itself can
 * never be deactivated or deleted this way. Also WordPress's own
 * auto-update settings, for plugins and for core.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Plugins {

	public static function register_routes( $auth ) {
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/plugins',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'index' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/plugins/manage',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'manage' ),
				'permission_callback' => $auth,
				'args'                => array(
					'plugin' => array(
						'required' => true,
						'type'     => 'string',
					),
					'action' => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'activate', 'deactivate', 'delete', 'enable-auto-update', 'disable-auto-update' ),
					),
				),
			)
		);
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/core/auto-update',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'set_core_auto_update' ),
				'permission_callback' => $auth,
				'args'                => array(
					'mode' => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'all', 'minor', 'off' ),
					),
				),
			)
		);
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/plugins/install',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'install' ),
				'permission_callback' => $auth,
				'args'                => array(
					'source'   => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'wordpress.org', 'url', 'zip' ),
					),
					// WordPress.org slug, such as "akismet".
					'slug'     => array( 'type' => 'string' ),
					'url'      => array( 'type' => 'string' ),
					// Base64 of the zip, sent by the dashboard.
					'package'  => array( 'type' => 'string' ),
					'activate' => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);
	}

	public static function index() {
		self::load_admin_includes();
		$own   = plugin_basename( PRESSER_CONNECT_FILE );
		$auto  = (array) get_site_option( 'auto_update_plugins', array() );
		// WordPress keeps each plugin's icons from its last update check, for
		// plugins with an update and without one.
		$checked = get_site_transient( 'update_plugins' );
		$checked = is_object( $checked ) ? array_merge( (array) ( $checked->no_update ?? array() ), (array) ( $checked->response ?? array() ) ) : array();
		$items   = array();
		foreach ( get_plugins() as $file => $data ) {
			$items[] = array(
				'file'           => $file,
				'name'           => html_entity_decode( wp_strip_all_tags( $data['Name'] ), ENT_QUOTES, 'UTF-8' ),
				'version'        => $data['Version'],
				'author'         => html_entity_decode( wp_strip_all_tags( $data['Author'] ), ENT_QUOTES, 'UTF-8' ),
				'active'         => is_plugin_active( $file ),
				'network_active' => is_multisite() && is_plugin_active_for_network( $file ),
				'protected'      => $file === $own,
				'auto_update'    => in_array( $file, $auto, true ),
				'icon_url'       => isset( $checked[ $file ]->icons ) ? Presser_Connect_Rest::plugin_icon( $checked[ $file ]->icons ) : '',
			);
		}
		return array(
			'plugins'          => $items,
			'can_modify_files' => wp_is_file_mod_allowed( 'presser_connect_plugins' ),
			// False when the site turns plugin auto-updates off in code.
			'auto_updates'     => wp_is_auto_update_enabled_for_type( 'plugin' ),
		);
	}

	/**
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function manage( $request ) {
		self::load_admin_includes();
		$file   = (string) $request['plugin'];
		$action = $request['action'];

		if ( ! array_key_exists( $file, get_plugins() ) ) {
			return new WP_Error( 'presser_not_found', __( 'That plugin is not installed.', 'presser-connect' ), array( 'status' => 404 ) );
		}
		if ( 'enable-auto-update' === $action && plugin_basename( PRESSER_CONNECT_FILE ) === $file ) {
			return new WP_Error( 'presser_protected', __( 'Presser keeps Presser Connect up to date itself.', 'presser-connect' ), array( 'status' => 409 ) );
		}
		if ( 'activate' !== $action && 'disable-auto-update' !== $action && plugin_basename( PRESSER_CONNECT_FILE ) === $file ) {
			return new WP_Error( 'presser_protected', __( 'Presser Connect cannot deactivate or delete itself from Presser. Do it in wp-admin if you mean to disconnect this site.', 'presser-connect' ), array( 'status' => 409 ) );
		}

		if ( 'enable-auto-update' === $action || 'disable-auto-update' === $action ) {
			return self::set_auto_update( $file, 'enable-auto-update' === $action );
		}

		if ( 'activate' === $action ) {
			$result = activate_plugin( $file, '', is_multisite() && is_plugin_active_for_network( $file ) );
			if ( is_wp_error( $result ) ) {
				return new WP_Error( 'presser_activate_failed', $result->get_error_message(), array( 'status' => 500 ) );
			}
			return array( 'ok' => true );
		}

		if ( 'deactivate' === $action ) {
			deactivate_plugins( $file, false, is_multisite() && is_plugin_active_for_network( $file ) );
			return array( 'ok' => true );
		}

		if ( ! wp_is_file_mod_allowed( 'presser_connect_plugins' ) ) {
			return self::file_mods_disabled();
		}
		// WordPress deletes only inactive plugins, as the Plugins screen does.
		if ( is_plugin_active( $file ) ) {
			deactivate_plugins( $file, true, is_multisite() && is_plugin_active_for_network( $file ) );
		}
		ob_start();
		$result = delete_plugins( array( $file ) );
		ob_end_clean();
		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'presser_delete_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( ! $result ) {
			return new WP_Error( 'presser_delete_failed', __( 'WordPress could not delete the plugin files. Check file permissions or FS_METHOD.', 'presser-connect' ), array( 'status' => 500 ) );
		}
		return array( 'ok' => true );
	}

	/**
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function install( $request ) {
		if ( ! wp_is_file_mod_allowed( 'presser_connect_plugins' ) ) {
			return self::file_mods_disabled();
		}
		self::load_admin_includes();
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}

		$temp = null;
		switch ( $request['source'] ) {
			case 'wordpress.org':
				$slug = sanitize_key( (string) $request['slug'] );
				if ( '' === $slug ) {
					return self::bad_request( __( 'Enter the plugin\'s WordPress.org slug.', 'presser-connect' ) );
				}
				$info = plugins_api(
					'plugin_information',
					array(
						'slug'   => $slug,
						'fields' => array( 'sections' => false ),
					)
				);
				if ( is_wp_error( $info ) ) {
					// "Plugin not found." for an unknown slug, or why WordPress.org could not be reached.
					return new WP_Error( 'presser_not_found', html_entity_decode( wp_strip_all_tags( $info->get_error_message() ), ENT_QUOTES, 'UTF-8' ), array( 'status' => 404 ) );
				}
				if ( empty( $info->download_link ) ) {
					return new WP_Error( 'presser_not_found', __( 'WordPress.org has no download for that plugin.', 'presser-connect' ), array( 'status' => 404 ) );
				}
				$package = $info->download_link;
				break;
			case 'url':
				$package = esc_url_raw( (string) $request['url'], array( 'http', 'https' ) );
				if ( '' === $package ) {
					return self::bad_request( __( 'Enter an http or https link to a plugin zip.', 'presser-connect' ) );
				}
				break;
			default:
				$bytes = base64_decode( (string) $request['package'], true );
				if ( false === $bytes || 'PK' !== substr( $bytes, 0, 2 ) ) {
					return self::bad_request( __( 'The upload is not a zip file.', 'presser-connect' ) );
				}
				$temp = wp_tempnam( 'presser-plugin.zip' );
				if ( ! $temp || false === file_put_contents( $temp, $bytes ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
					return self::filesystem_error();
				}
				$package = $temp;
		}

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = new Plugin_Upgrader( $skin );
		ob_start();
		$result = $upgrader->install( $package );
		ob_end_clean();
		if ( $temp && file_exists( $temp ) ) {
			wp_delete_file( $temp );
		}

		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'presser_install_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( 'folder_exists' === $skin->get_errors()->get_error_code() ) {
			return new WP_Error( 'presser_install_failed', __( 'That plugin is already installed. Update it from the updates list instead.', 'presser-connect' ), array( 'status' => 409 ) );
		}
		if ( $skin->get_errors()->has_errors() ) {
			return new WP_Error( 'presser_install_failed', $skin->get_error_messages(), array( 'status' => 500 ) );
		}
		if ( ! $result ) {
			return self::filesystem_error();
		}

		$file = $upgrader->plugin_info();
		if ( ! $file ) {
			return new WP_Error( 'presser_install_failed', __( 'The package installed, but WordPress found no plugin in it.', 'presser-connect' ), array( 'status' => 500 ) );
		}
		$activated = false;
		if ( $request['activate'] ) {
			wp_clean_plugins_cache();
			$activation = activate_plugin( $file );
			if ( is_wp_error( $activation ) ) {
				return new WP_Error(
					'presser_activate_failed',
					/* translators: %s: error message */
					sprintf( __( 'The plugin installed but did not activate: %s', 'presser-connect' ), $activation->get_error_message() ),
					array( 'status' => 500 )
				);
			}
			$activated = true;
		}
		return array(
			'ok'        => true,
			'plugin'    => $file,
			'activated' => $activated,
		);
	}

	/**
	 * Turn WordPress's own auto-updates on or off for one plugin, as the
	 * Plugins screen's "Enable auto-updates" link does.
	 *
	 * @param string $file    Plugin file.
	 * @param bool   $enabled Whether WordPress should update it automatically.
	 */
	private static function set_auto_update( $file, $enabled ) {
		if ( ! wp_is_auto_update_enabled_for_type( 'plugin' ) ) {
			return new WP_Error( 'presser_auto_updates_disabled', __( 'Plugin auto-updates are turned off on this site in code (the plugins_auto_update_enabled filter).', 'presser-connect' ), array( 'status' => 409 ) );
		}
		$auto = (array) get_site_option( 'auto_update_plugins', array() );
		$auto = $enabled ? array_merge( $auto, array( $file ) ) : array_diff( $auto, array( $file ) );
		// Drop plugins that are no longer installed, as WordPress does.
		$auto = array_values( array_unique( array_intersect( $auto, array_keys( get_plugins() ) ) ) );
		update_site_option( 'auto_update_plugins', $auto );
		return array( 'ok' => true );
	}

	/**
	 * WordPress core auto-updates: "all" versions, "minor" (maintenance and
	 * security releases only, WordPress's default) or "off". Locked when
	 * wp-config.php decides it with WP_AUTO_UPDATE_CORE or
	 * AUTOMATIC_UPDATER_DISABLED.
	 */
	public static function core_auto_update() {
		if ( defined( 'AUTOMATIC_UPDATER_DISABLED' ) && AUTOMATIC_UPDATER_DISABLED ) {
			return array(
				'mode'   => 'off',
				'locked' => true,
			);
		}
		if ( defined( 'WP_AUTO_UPDATE_CORE' ) ) {
			$value = WP_AUTO_UPDATE_CORE;
			return array(
				'mode'   => false === $value ? 'off' : ( 'minor' === $value ? 'minor' : 'all' ),
				'locked' => true,
			);
		}
		$major = 'enabled' === get_site_option( 'auto_update_core_major', 'unset' );
		$minor = 'enabled' === get_site_option( 'auto_update_core_minor', 'enabled' );
		return array(
			'mode'   => $major ? 'all' : ( $minor ? 'minor' : 'off' ),
			'locked' => false,
		);
	}

	/**
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function set_core_auto_update( $request ) {
		if ( self::core_auto_update()['locked'] ) {
			return new WP_Error( 'presser_auto_updates_locked', __( 'This site\'s wp-config.php sets WordPress auto-updates (WP_AUTO_UPDATE_CORE or AUTOMATIC_UPDATER_DISABLED), so they cannot be changed from Presser.', 'presser-connect' ), array( 'status' => 409 ) );
		}
		$mode = $request['mode'];
		// The same site options the Updates screen sets; minor also covers
		// development versions, as WordPress does.
		update_site_option( 'auto_update_core_major', 'all' === $mode ? 'enabled' : 'disabled' );
		update_site_option( 'auto_update_core_minor', 'off' === $mode ? 'disabled' : 'enabled' );
		update_site_option( 'auto_update_core_dev', 'off' === $mode ? 'disabled' : 'enabled' );
		return self::core_auto_update();
	}

	private static function bad_request( $message ) {
		return new WP_Error( 'presser_bad_request', $message, array( 'status' => 400 ) );
	}

	private static function file_mods_disabled() {
		return new WP_Error( 'presser_file_mods_disabled', __( 'File changes are disabled on this site (DISALLOW_FILE_MODS).', 'presser-connect' ), array( 'status' => 409 ) );
	}

	private static function filesystem_error() {
		return new WP_Error( 'presser_install_failed', __( 'WordPress could not write to its files. Check file permissions or FS_METHOD.', 'presser-connect' ), array( 'status' => 500 ) );
	}

	private static function load_admin_includes() {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/update.php';
	}
}
