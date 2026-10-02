<?php
// Runs KontrolWP_Connect_Accessibility::transform outside WordPress.
// Input (JSON on stdin): { "html": "...", "fixes": ["image_alt", ...] }; prints the rewritten HTML.

define( 'ABSPATH', __DIR__ . '/' );
function wp_parse_url( $url, $component = -1 ) { return parse_url( $url, $component ); }
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-accessibility.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo KontrolWP_Connect_Accessibility::transform( $input['html'], $input['fixes'] );
