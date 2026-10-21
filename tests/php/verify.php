<?php
// Runs KontrolWP_Connect_Auth::verify outside WordPress with minimal stubs.
// Input (JSON on stdin), one of:
//   { "create_key": true, "requests": [...] }  the plugin makes a key, then
//                                              verifies requests signed with it
//   { "credentials": {...}, "requests": [...] }  credentials as an older
//                                              version saved them, in the clear
//   { "stored": {...}, "requests": [...] }       the option exactly as saved
// The output's "stored" is the option afterwards.
// Each request is { method, route, body, headers } and gets back "ok" or the
// error message. Requests may use "$KEY_ID" to mean the created key's id.

define( 'ABSPATH', __DIR__ . '/' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'AUTH_KEY', getenv( 'KWP_AUTH_KEY' ) ?: 'test auth key' );
define( 'AUTH_SALT', 'test auth salt' );

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
function delete_option( $name ) { unset( $GLOBALS['options'][ $name ] ); return true; }
function wp_json_encode( $value, $flags = 0 ) { return json_encode( $value, $flags ); }
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

require dirname( __DIR__, 2 ) . '/plugin/kontrolwp-connect/includes/class-kontrolwp-connect-auth.php';

$input = json_decode( stream_get_contents( STDIN ), true );
$output = array();
if ( ! empty( $input['create_key'] ) ) {
	$output['connection_key'] = KontrolWP_Connect_Auth::connection_key();
} else {
	$GLOBALS['options']['kontrolwp_connect'] = $input['stored'] ?? $input['credentials'];
}
$output['results'] = array();
foreach ( $input['requests'] ?? array() as $request ) {
	$result                = KontrolWP_Connect_Auth::verify( new Request( $request ) );
	$output['results'][] = true === $result ? 'ok' : $result->message;
}
$output['stored'] = $GLOBALS['options']['kontrolwp_connect'] ?? null;
echo json_encode( $output );
