<?php
// Runs the pure parts of KontrolWP_Connect_SEO_Tools outside WordPress.
// Input (JSON on stdin): { "fn": "clean_code|clean|robots_error|robots_output|llms_auto|indexnow_payload", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-seo-tools.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_SEO_Tools', $input['fn'] ), $input['args'] ) );
