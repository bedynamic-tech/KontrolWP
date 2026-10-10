<?php
/**
 * Previous versions. Before KontrolWP updates a plugin or theme, the
 * installed copy is zipped into wp-content/kontrolwp-rollback, so the owner
 * can put it back with one click. One copy per plugin or theme, kept for
 * KEEP_DAYS; reverting installs it and then deletes it.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Rollback {

	const OPTION    = 'kontrolwp_connect_rollbacks';
	const FOLDER    = 'kontrolwp-rollback';
	const KEEP_DAYS = 30;

	public static function register_routes( $auth ) {
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/updates/rollback',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'restore' ),
				'permission_callback' => $auth,
				'args'                => array(
					'kind' => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'plugin', 'theme' ),
					),
					'slug' => array(
						'required' => true,
						'type'     => 'string',
					),
				),
			)
		);
	}

	/** Where the copies live, created with guards against being served. */
	public static function dir() {
		return trailingslashit( WP_CONTENT_DIR ) . self::FOLDER;
	}

	/**
	 * Zip the installed copy of a plugin or theme before it is updated.
	 * Returns what commit() needs, or null when there is nothing to keep
	 * (a single-file plugin, KontrolWP Connect itself) or the zip failed;
	 * the update goes ahead either way.
	 *
	 * @param string $kind plugin or theme.
	 * @param string $slug Plugin file or theme stylesheet.
	 */
	public static function prepare( $kind, $slug ) {
		$item = self::installed( $kind, $slug );
		if ( ! $item || '' === $item['version'] ) {
			return null;
		}
		if ( 'plugin' === $kind && defined( 'KONTROLWP_CONNECT_FILE' ) && plugin_basename( KONTROLWP_CONNECT_FILE ) === $slug ) {
			return null;
		}
		$dir = self::dir();
		if ( ! self::ensure_dir( $dir ) ) {
			return null;
		}
		// An unguessable name, so a server that ignores .htaccess still never serves it.
		$file = $dir . '/' . $kind . '-' . sanitize_file_name( basename( $item['path'] ) ) . '-' . wp_generate_password( 20, false ) . '.zip';
		if ( ! self::zip_folder( $item['path'], $file ) ) {
			if ( file_exists( $file ) ) {
				wp_delete_file( $file );
			}
			return null;
		}
		return array(
			'kind'    => $kind,
			'slug'    => $slug,
			'name'    => $item['name'],
			'version' => $item['version'],
			'file'    => basename( $file ),
		);
	}

	/**
	 * Keep a copy made by prepare() once its update succeeded, in place of
	 * any older copy of the same plugin or theme.
	 *
	 * @param array $backup From prepare().
	 */
	public static function commit( $backup ) {
		$all = self::stored();
		$key = $backup['kind'] . ':' . $backup['slug'];
		if ( isset( $all[ $key ] ) ) {
			self::delete_file( $all[ $key ]['file'] );
		}
		$backup['time'] = time();
		$all[ $key ]    = $backup;
		update_option( self::OPTION, $all, false );
	}

	/**
	 * Throw away a copy made by prepare() whose update failed.
	 *
	 * @param array $backup From prepare().
	 */
	public static function discard( $backup ) {
		self::delete_file( $backup['file'] );
	}

	/**
	 * The previous versions that can be put back, for the dashboard's sync.
	 * Copies that expired, lost their zip, belong to something no longer
	 * installed, or match what is installed now are deleted first.
	 */
	public static function items() {
		$all     = self::stored();
		$changed = false;
		$items   = array();
		foreach ( $all as $key => $backup ) {
			$item = self::installed( $backup['kind'], $backup['slug'] );
			$keep = $item
				&& $item['version'] !== $backup['version']
				&& (int) $backup['time'] > time() - self::KEEP_DAYS * DAY_IN_SECONDS
				&& file_exists( self::dir() . '/' . $backup['file'] );
			if ( ! $keep ) {
				self::delete_file( $backup['file'] );
				unset( $all[ $key ] );
				$changed = true;
				continue;
			}
			$items[] = array(
				'kind'            => $backup['kind'],
				'slug'            => $backup['slug'],
				'name'            => $item['name'],
				'version'         => $backup['version'],
				'current_version' => $item['version'],
				'created_at'      => (int) $backup['time'],
			);
		}
		if ( $changed ) {
			update_option( self::OPTION, $all, false );
		}
		return $items;
	}

	/**
	 * Put the kept version back in place of the installed one, the way
	 * uploading a plugin or theme zip and choosing "Replace current" does.
	 * A plugin stays active.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function restore( $request ) {
		$kind = (string) $request['kind'];
		$slug = (string) $request['slug'];
		if ( ! wp_is_file_mod_allowed( 'kontrolwp_connect_update' ) ) {
			return new WP_Error( 'kontrolwp_file_mods_disabled', __( 'File changes are disabled on this site (DISALLOW_FILE_MODS).', 'kontrolwp-connect' ), array( 'status' => 409 ) );
		}
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/theme.php';

		$all    = self::stored();
		$key    = $kind . ':' . $slug;
		$backup = isset( $all[ $key ] ) ? $all[ $key ] : null;
		$zip    = $backup ? self::dir() . '/' . $backup['file'] : '';
		if ( ! $backup || ! file_exists( $zip ) ) {
			return new WP_Error( 'kontrolwp_no_rollback', __( 'The previous version is no longer on the site.', 'kontrolwp-connect' ), array( 'status' => 404 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 300 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		// The upgrader deletes the package it unpacks; give it a copy so a failed revert keeps the original.
		$package = wp_tempnam( $backup['file'] );
		if ( ! $package || ! copy( $zip, $package ) ) {
			return new WP_Error( 'kontrolwp_update_failed', __( 'WordPress could not write to its files. Check file permissions or FS_METHOD.', 'kontrolwp-connect' ), array( 'status' => 500 ) );
		}

		$skin     = new WP_Ajax_Upgrader_Skin();
		$upgrader = 'plugin' === $kind ? new Plugin_Upgrader( $skin ) : new Theme_Upgrader( $skin );
		ob_start();
		$result = $upgrader->install( $package, array( 'overwrite_package' => true ) );
		ob_end_clean();
		if ( file_exists( $package ) ) {
			wp_delete_file( $package );
		}

		if ( is_wp_error( $result ) ) {
			return new WP_Error( 'kontrolwp_rollback_failed', $result->get_error_message(), array( 'status' => 500 ) );
		}
		if ( $skin->get_errors()->has_errors() ) {
			return new WP_Error( 'kontrolwp_rollback_failed', $skin->get_error_messages(), array( 'status' => 500 ) );
		}
		if ( ! $result ) {
			return new WP_Error( 'kontrolwp_rollback_failed', __( 'The previous version could not be installed.', 'kontrolwp-connect' ), array( 'status' => 500 ) );
		}

		self::delete_file( $backup['file'] );
		unset( $all[ $key ] );
		update_option( self::OPTION, $all, false );
		return array(
			'ok'      => true,
			'version' => $backup['version'],
		);
	}

	/** Delete every copy; for uninstall. */
	public static function delete_all() {
		$dir = self::dir();
		foreach ( (array) glob( $dir . '/*' ) as $file ) {
			if ( is_file( $file ) ) {
				unlink( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
			}
		}
		if ( file_exists( $dir . '/.htaccess' ) ) {
			unlink( $dir . '/.htaccess' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
		}
		if ( is_dir( $dir ) ) {
			rmdir( $dir ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
		}
		delete_option( self::OPTION );
	}

	/**
	 * Name, version and folder of an installed plugin or theme, or null.
	 *
	 * @param string $kind plugin or theme.
	 * @param string $slug Plugin file or theme stylesheet.
	 */
	private static function installed( $kind, $slug ) {
		if ( 'plugin' === $kind ) {
			if ( ! function_exists( 'get_plugins' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			$plugins = get_plugins();
			// A plugin that is a single file in wp-content/plugins has no folder to keep.
			if ( ! isset( $plugins[ $slug ] ) || '.' === dirname( $slug ) ) {
				return null;
			}
			return array(
				'name'    => (string) $plugins[ $slug ]['Name'],
				'version' => (string) $plugins[ $slug ]['Version'],
				'path'    => WP_PLUGIN_DIR . '/' . dirname( $slug ),
			);
		}
		$theme = wp_get_theme( $slug );
		if ( ! $theme->exists() ) {
			return null;
		}
		return array(
			'name'    => (string) $theme->get( 'Name' ),
			'version' => (string) $theme->get( 'Version' ),
			'path'    => $theme->get_stylesheet_directory(),
		);
	}

	/** @return array<string, array> Kept copies keyed by kind:slug. */
	private static function stored() {
		$all = get_option( self::OPTION, array() );
		return is_array( $all ) ? $all : array();
	}

	private static function delete_file( $name ) {
		$file = self::dir() . '/' . basename( (string) $name );
		if ( '' !== basename( (string) $name ) && is_file( $file ) ) {
			wp_delete_file( $file );
		}
	}

	/**
	 * Create the folder with an empty index and a deny rule, so the old code
	 * in it is never served.
	 *
	 * @param string $dir Folder.
	 */
	private static function ensure_dir( $dir ) {
		if ( ! is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
			return false;
		}
		$guards = array(
			'index.php' => "<?php\n// Silence is golden.\n",
			'.htaccess' => "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n",
		);
		foreach ( $guards as $name => $content ) {
			if ( ! file_exists( $dir . '/' . $name ) ) {
				file_put_contents( $dir . '/' . $name, $content ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
			}
		}
		return is_writable( $dir );
	}

	/**
	 * Zip a folder with the folder itself as the zip's top level, which is
	 * the layout WordPress expects of a plugin or theme package.
	 *
	 * @param string $source Folder to zip.
	 * @param string $target Zip file to write.
	 */
	public static function zip_folder( $source, $target ) {
		$source = untrailingslashit( $source );
		if ( ! is_dir( $source ) ) {
			return false;
		}
		$base = dirname( $source );
		if ( class_exists( 'ZipArchive' ) ) {
			$zip = new ZipArchive();
			if ( true !== $zip->open( $target, ZipArchive::CREATE | ZipArchive::OVERWRITE ) ) {
				return false;
			}
			$zip->addEmptyDir( basename( $source ) );
			$files = new RecursiveIteratorIterator(
				new RecursiveDirectoryIterator( $source, FilesystemIterator::SKIP_DOTS ),
				RecursiveIteratorIterator::SELF_FIRST
			);
			foreach ( $files as $file ) {
				$local = str_replace( '\\', '/', substr( $file->getPathname(), strlen( $base ) + 1 ) );
				if ( $file->isDir() ) {
					$zip->addEmptyDir( $local );
				} elseif ( $file->isFile() && ! $zip->addFile( $file->getPathname(), $local ) ) {
					$zip->close();
					return false;
				}
			}
			return $zip->close();
		}
		require_once ABSPATH . 'wp-admin/includes/class-pclzip.php';
		$zip = new PclZip( $target );
		return 0 !== $zip->create( $source, PCLZIP_OPT_REMOVE_PATH, $base );
	}
}
