<?php
// Runs the pure part of KontrolWP_Connect_Update_Emails outside WordPress.
// Input (JSON on stdin): { "fn": "suppressed", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-update-emails.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Update_Emails', $input['fn'] ), $input['args'] ) );
