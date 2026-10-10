<?php
// Runs KontrolWP_Connect_Rollback's copy keeping outside WordPress, against a
// temporary wp-content with one plugin folder.
// Input (JSON on stdin): { "content": "<dir>", "steps": [[fn, ...args], ...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
define( 'DAY_IN_SECONDS', 86400 );
$input = json_decode( stream_get_contents( STDIN ), true );
define( 'WP_CONTENT_DIR', $input['content'] );
define( 'WP_PLUGIN_DIR', $input['content'] . '/plugins' );

class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }

$GLOBALS['options'] = array();
$GLOBALS['plugins'] = array();
function get_option( $name, $fallback = false ) { return array_key_exists( $name, $GLOBALS['options'] ) ? $GLOBALS['options'][ $name ] : $fallback; }
function update_option( $name, $value, $autoload = null ) { $GLOBALS['options'][ $name ] = $value; return true; }
function delete_option( $name ) { unset( $GLOBALS['options'][ $name ] ); return true; }
function get_plugins() { return $GLOBALS['plugins']; }
function plugin_basename( $file ) { return 'kontrolwp-connect/kontrolwp-connect.php'; }
function trailingslashit( $s ) { return rtrim( $s, '/\\' ) . '/'; }
function untrailingslashit( $s ) { return rtrim( $s, '/\\' ); }
function sanitize_file_name( $s ) { return preg_replace( '/[^A-Za-z0-9._-]/', '', $s ); }
function wp_generate_password( $length ) { return substr( bin2hex( random_bytes( $length ) ), 0, $length ); }
function wp_mkdir_p( $dir ) { return is_dir( $dir ) || mkdir( $dir, 0777, true ); }
function wp_delete_file( $file ) { @unlink( $file ); }

require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-rollback.php';

$out = array();
foreach ( $input['steps'] as $step ) {
	$fn = array_shift( $step );
	switch ( $fn ) {
		case 'plugins':
			$GLOBALS['plugins'] = $step[0];
			$out[] = null;
			break;
		case 'age':
			// Make every kept copy this many days old.
			$all = get_option( KontrolWP_Connect_Rollback::OPTION, array() );
			foreach ( $all as $key => $backup ) {
				$all[ $key ]['time'] = time() - $step[0] * DAY_IN_SECONDS;
			}
			update_option( KontrolWP_Connect_Rollback::OPTION, $all );
			$out[] = null;
			break;
		case 'prepare_commit':
			$backup = KontrolWP_Connect_Rollback::prepare( $step[0], $step[1] );
			if ( $backup ) {
				KontrolWP_Connect_Rollback::commit( $backup );
			}
			$out[] = $backup;
			break;
		case 'prepare_discard':
			$backup = KontrolWP_Connect_Rollback::prepare( $step[0], $step[1] );
			if ( $backup ) {
				KontrolWP_Connect_Rollback::discard( $backup );
			}
			$out[] = $backup;
			break;
		case 'zip_entries':
			$zip   = new ZipArchive();
			$zip->open( KontrolWP_Connect_Rollback::dir() . '/' . $step[0] );
			$names = array();
			for ( $i = 0; $i < $zip->numFiles; $i++ ) {
				$names[] = $zip->getNameIndex( $i );
			}
			sort( $names );
			$out[] = $names;
			break;
		case 'files':
			$names = array_values( array_diff( scandir( KontrolWP_Connect_Rollback::dir() ), array( '.', '..' ) ) );
			$out[] = $names;
			break;
		default:
			$out[] = call_user_func_array( array( 'KontrolWP_Connect_Rollback', $fn ), $step );
	}
}
echo json_encode( $out );
