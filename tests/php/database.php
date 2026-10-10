<?php
// Runs the pure part of KontrolWP_Connect_Database outside WordPress.
// Input (JSON on stdin): { "fn": "clean_items", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-database.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Database', $input['fn'] ), $input['args'] ) );
