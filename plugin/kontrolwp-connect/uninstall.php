<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'kontrolwp_connect' );
delete_option( 'kontrolwp_connect_last_seen' );
delete_option( 'kontrolwp_connect_seo' );
delete_option( 'kontrolwp_connect_redirects_db' );
delete_option( 'kontrolwp_connect_redirects_state' );
delete_option( 'kontrolwp_connect_seo_tools' );
delete_option( 'kontrolwp_connect_seo_tools_texts' );

require_once __DIR__ . '/includes/class-kontrolwp-connect-login.php';
KontrolWP_Connect_Login::delete_all();
