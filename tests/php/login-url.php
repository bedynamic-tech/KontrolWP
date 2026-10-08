<?php
// Runs the pure parts of KontrolWP_Connect_Login_URL outside WordPress.
// Input (JSON on stdin): { "fn": "normalize_slug|slug_error|relative_path|is_login_request|direct_allowed|admin_open|rewrite_url|clean", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-login-url.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Login_URL', $input['fn'] ), $input['args'] ) );
