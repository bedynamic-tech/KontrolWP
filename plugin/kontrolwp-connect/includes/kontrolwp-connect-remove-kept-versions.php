<?php
/**
 * KontrolWP no longer reverts updates. Versions 0.36.0 to 0.46.0 kept a zip of
 * each plugin or theme before updating it, in wp-content/kontrolwp-rollback;
 * this deletes those copies and their list once, and on uninstall.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function kontrolwp_connect_remove_kept_versions() {
	$dir = trailingslashit( WP_CONTENT_DIR ) . 'kontrolwp-rollback';
	if ( false === get_option( 'kontrolwp_connect_rollbacks' ) && ! is_dir( $dir ) ) {
		return;
	}
	if ( is_dir( $dir ) ) {
		foreach ( (array) glob( $dir . '/{,.}*', GLOB_BRACE ) as $file ) {
			if ( is_file( $file ) ) {
				unlink( $file ); // phpcs:ignore WordPress.WP.AlternativeFunctions.unlink_unlink
			}
		}
		rmdir( $dir ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_rmdir
	}
	delete_option( 'kontrolwp_connect_rollbacks' );
}
