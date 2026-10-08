<?php
// Runs the pure parts of KontrolWP_Connect_Snippets outside WordPress.
// Input (JSON on stdin): { "fn": "clean_path|path_matches|applies|clean_snippet|snippet_error|clean|label|for_location", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-snippets.php';

$input = json_decode( stream_get_contents( STDIN ), true );
if ( 'clean' === $input['fn'] ) {
	$n = 0;
	$input['args'][1] = function () use ( &$n ) {
		return 'gen' . str_pad( (string) ++$n, 4, '0', STR_PAD_LEFT ) . 'xx';
	};
}
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_Snippets', $input['fn'] ), $input['args'] ) );
