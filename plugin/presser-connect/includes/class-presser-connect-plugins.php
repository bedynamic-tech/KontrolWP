<?php
/**
 * Plugin management for the dashboard: list installed plugins, activate,
 * deactivate or delete one, and install new ones from WordPress.org, a URL
 * or an uploaded zip. Everything goes through WordPress's own functions and
 * Plugin_Upgrader, as the Plugins screen does. Presser Connect itself can
 * never be deactivated or deleted this way.
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
						'enum'     => array( 'activate', 'deactivate', 'delete' ),
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
		$items = array();
		foreach ( get_plugins() as $file => $data ) {
			$items[] = array(
				'file'           => $file,
				'name'           => html_entity_decode( wp_strip_all_tags( $data['Name'] ), ENT_QUOTES, 'UTF-8' ),
				'version'        => $data['Version'],
				'author'         => html_entity_decode( wp_strip_all_tags( $data['Author'] ), ENT_QUOTES, 'UTF-8' ),
				'active'         => is_plugin_active( $file ),
				'network_active' => is_multisite() && is_plugin_active_for_network( $file ),
				'protected'      => $file === $own,
			);
		}
		return array(
			'plugins'          => $items,
			'can_modify_files' => wp_is_file_mod_allowed( 'presser_connect_plugins' ),
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
		if ( 'activate' !== $action && plugin_basename( PRESSER_CONNECT_FILE ) === $file ) {
			return new WP_Error( 'presser_protected', __( 'Presser Connect cannot deactivate or delete itself from Presser. Do it in wp-admin if you mean to disconnect this site.', 'presser-connect' ), array( 'status' => 409 ) );
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
	}
}
