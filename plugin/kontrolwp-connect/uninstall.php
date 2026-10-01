<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'kontrolwp_connect' );
delete_option( 'kontrolwp_connect_last_seen' );

require_once __DIR__ . '/includes/class-kontrolwp-connect-login.php';
KontrolWP_Connect_Login::delete_all();
