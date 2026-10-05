<?php
// Runs the pure parts of KontrolWP_Connect_Links outside WordPress.
// Input (JSON on stdin): { "fn": "extract|merge", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
function wp_strip_all_tags( $text ) { return trim( strip_tags( $text ) ); }
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
function is_ssl() { return true; }
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-links.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Links', $input['fn'] ), $input['args'] ) );
