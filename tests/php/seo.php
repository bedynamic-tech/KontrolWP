<?php
// Runs the pure parts of KontrolWP_Connect_SEO outside WordPress.
// Input (JSON on stdin): { "fn": "clean|fill_template|trim_description|head_html", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
function wp_strip_all_tags( $text ) { return trim( strip_tags( $text ) ); }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
function strip_shortcodes( $text ) { return preg_replace( '/\[[^\]]+\]/', '', $text ); }
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-seo.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_SEO', $input['fn'] ), $input['args'] ) );
