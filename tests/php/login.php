<?php
// Runs KontrolWP_Connect_Login::create outside WordPress, with an options table
// that $wpdb reads using MySQL's LIKE rules. Input (JSON on stdin):
// { "options": { name: value } }; prints the option names left afterwards.

define( 'ABSPATH', __DIR__ . '/' );
$GLOBALS['options'] = array();
function __( $text ) { return $text; }
function get_option( $name, $default = false ) { return $GLOBALS['options'][ $name ] ?? $default; }
function add_option( $name, $value ) { $GLOBALS['options'][ $name ] = $value; return true; }
function delete_option( $name ) { unset( $GLOBALS['options'][ $name ] ); return true; }
function get_userdata( $id ) { return (object) array( 'ID' => $id ); }
function user_can( $user, $cap ) { return true; }
function add_query_arg( $args, $url ) { return $url . '?' . http_build_query( $args ); }
function wp_login_url() { return 'https://example.com/wp-login.php'; }

class Options_Db {
	public $options = 'wp_options';
	public function esc_like( $text ) { return addcslashes( $text, '_%\\' ); }
	public function prepare( $sql, $value ) { return str_replace( '%s', "'" . $value . "'", $sql ); }
	public function get_col( $sql ) {
		preg_match( "/LIKE '(.*)'( LIMIT (\\d+))?$/", $sql, $m );
		$regex = '/^' . preg_replace_callback(
			'/\\\\(.)|(_)|(%)|(.)/s',
			static function ( $c ) {
				if ( '' !== $c[1] ) return preg_quote( $c[1], '/' );
				if ( isset( $c[2] ) && '' !== $c[2] ) return '.';
				if ( isset( $c[3] ) && '' !== $c[3] ) return '.*';
				return preg_quote( $c[4], '/' );
			},
			$m[1]
		) . '$/s';
		$names = array_values( preg_grep( $regex, array_keys( $GLOBALS['options'] ) ) );
		return isset( $m[3] ) ? array_slice( $names, 0, (int) $m[3] ) : $names;
	}
}
$GLOBALS['wpdb'] = new Options_Db();

require dirname( __DIR__, 2 ) . '/plugin/kontrolwp-connect/includes/class-kontrolwp-connect-login.php';

$input              = json_decode( stream_get_contents( STDIN ), true );
$GLOBALS['options'] = $input['options'];
KontrolWP_Connect_Login::create( array( 'user_id' => 1, 'post_id' => 0 ) );
echo json_encode( array_keys( $GLOBALS['options'] ) );
