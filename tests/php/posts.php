<?php
// Runs the pure parts of KontrolWP_Connect_Posts outside WordPress.
// Input (JSON on stdin): { "fn": "clean_post|upload_limit|inspect|file_name", "args": [...] }; prints JSON. inspect takes its bytes as base64.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-posts.php';

$input = json_decode( stream_get_contents( STDIN ), true );
if ( 'inspect' === $input['fn'] ) {
	$input['args'][0] = base64_decode( $input['args'][0] );
}
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Posts', $input['fn'] ), $input['args'] ) );
