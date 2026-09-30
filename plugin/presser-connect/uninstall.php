<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'presser_connect' );
delete_option( 'presser_connect_last_seen' );

require_once __DIR__ . '/includes/class-presser-connect-login.php';
Presser_Connect_Login::delete_all();
