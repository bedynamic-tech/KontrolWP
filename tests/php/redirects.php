<?php
// Runs the pure parts of KontrolWP_Connect_Redirects outside WordPress.
// Input (JSON on stdin): { "fn": "normalize_path|key|clean_rule|match_rule", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-redirects.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Redirects', $input['fn'] ), $input['args'] ) );
