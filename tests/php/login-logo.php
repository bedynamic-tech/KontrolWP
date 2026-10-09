<?php
// Runs the pure parts of KontrolWP_Connect_Login_Logo outside WordPress.
// Input (JSON on stdin): { "fn": "clean|fit|inspect|css", "args": [...] }; prints JSON. inspect takes its bytes as base64.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-login-logo.php';

$input = json_decode( stream_get_contents( STDIN ), true );
if ( 'inspect' === $input['fn'] ) {
	$input['args'][0] = base64_decode( $input['args'][0] );
}
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Login_Logo', $input['fn'] ), $input['args'] ) );
