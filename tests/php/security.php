<?php
// Runs KontrolWP_Connect_Security::risky_signup_role outside WordPress.
// Input (JSON on stdin): { "multisite": bool, "options": {...}, "roles": { slug: { name, caps } } }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-security.php';

$input = json_decode( stream_get_contents( STDIN ), true );

function is_multisite() {
	global $input;
	return ! empty( $input['multisite'] );
}
function get_option( $name, $fallback = false ) {
	global $input;
	return array_key_exists( $name, $input['options'] ) ? $input['options'][ $name ] : $fallback;
}
function get_role( $slug ) {
	global $input;
	return isset( $input['roles'][ $slug ] ) ? (object) array( 'capabilities' => $input['roles'][ $slug ]['caps'] ) : null;
}
function wp_roles() {
	global $input;
	return new class( $input['roles'] ) {
		public function __construct( $roles ) { $this->roles = $roles; }
		public $roles;
		public function get_names() { return array_map( function ( $role ) { return $role['name']; }, $this->roles ); }
	};
}
function translate_user_role( $name ) {
	return $name;
}

echo json_encode( KontrolWP_Connect_Security::risky_signup_role() );
