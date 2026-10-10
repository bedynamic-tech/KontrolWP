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
delete_option( 'kontrolwp_connect_seo_content' );
delete_option( 'kontrolwp_connect_snippets' );
delete_option( 'kontrolwp_connect_snippets_active' );
delete_option( 'kontrolwp_connect_update_emails' );
delete_option( 'kontrolwp_connect_login_url' );
delete_option( 'kontrolwp_connect_maintenance' );

require_once __DIR__ . '/includes/class-kontrolwp-connect-login.php';
KontrolWP_Connect_Login::delete_all();

require_once __DIR__ . '/includes/class-kontrolwp-connect-login-logo.php';
KontrolWP_Connect_Login_Logo::delete_all();

require_once __DIR__ . '/includes/class-kontrolwp-connect-rollback.php';
KontrolWP_Connect_Rollback::delete_all();
