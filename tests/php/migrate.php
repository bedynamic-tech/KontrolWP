<?php
// Runs the pure parts of KontrolWP_Connect_Migrate outside WordPress.
// Input (JSON on stdin): { "fn": "convert_tokens|map_separator|is_noindex|rankmath_rules|dig", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
function wp_strip_all_tags( $text ) { return trim( strip_tags( $text ) ); }
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-seo.php';
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-migrate.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Migrate', $input['fn'] ), $input['args'] ) );
