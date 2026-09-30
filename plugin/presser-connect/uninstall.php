<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'presser_connect' );
delete_option( 'presser_connect_last_seen' );
