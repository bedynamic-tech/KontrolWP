<?php
// Runs Presser_Connect_Auth::verify outside WordPress with minimal stubs.
// Input (JSON on stdin): { connection, method, route, body, headers, now_offset? }
// Output: "ok" or the WP_Error code and message.

define( 'ABSPATH', __DIR__ . '/' );
define( 'HOUR_IN_SECONDS', 3600 );

class WP_Error {
	public $code;
	public $message;
	public function __construct( $code, $message ) {
		$this->code    = $code;
		$this->message = $message;
	}
}
$GLOBALS['options']    = array();
$GLOBALS['transients'] = array();
function __( $text ) { return $text; }
function esc_url_raw( $url ) { return $url; }
function get_option( $name, $default = false ) { return $GLOBALS['options'][ $name ] ?? $default; }
function update_option( $name, $value ) { $GLOBALS['options'][ $name ] = $value; return true; }
function get_transient( $name ) { return $GLOBALS['transients'][ $name ] ?? false; }
function set_transient( $name, $value ) { $GLOBALS['transients'][ $name ] = $value; return true; }

class Request {
	private $input;
	public function __construct( $input ) { $this->input = $input; }
	public function get_header( $name ) {
		foreach ( $this->input['headers'] as $key => $value ) {
			if ( strtolower( $key ) === strtolower( $name ) ) {
				return $value;
			}
		}
		return null;
	}
	public function get_method() { return $this->input['method']; }
	public function get_route() { return $this->input['route']; }
	public function get_body() { return $this->input['body']; }
}

require dirname( __DIR__, 2 ) . '/plugin/presser-connect/includes/class-presser-connect-auth.php';

$input = json_decode( stream_get_contents( STDIN ), true );
if ( isset( $input['connection_key'] ) ) {
	$parsed = Presser_Connect_Auth::parse_connection_key( $input['connection_key'] );
	echo json_encode( $parsed instanceof WP_Error ? array( 'error' => $parsed->code ) : $parsed );
	exit;
}
$GLOBALS['options']['presser_connect'] = $input['connection'];
$results = array();
foreach ( $input['requests'] as $request ) {
	$result    = Presser_Connect_Auth::verify( new Request( $request ) );
	$results[] = true === $result ? 'ok' : $result->message;
}
echo json_encode( $results );
