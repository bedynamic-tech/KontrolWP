<?php
// Runs the pure part of KontrolWP_Connect_Maintenance outside WordPress.
// Input (JSON on stdin): { "fn": "clean", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-maintenance.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Maintenance', $input['fn'] ), $input['args'] ) );
