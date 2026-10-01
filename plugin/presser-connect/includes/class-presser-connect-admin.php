<?php
/**
 * Settings, KontrolWP Connect: where the owner copies this site's Connection Key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Admin {

	const PAGE = 'presser-connect';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_post_presser_connect_regenerate', array( __CLASS__, 'regenerate' ) );
		add_action( 'admin_notices', array( __CLASS__, 'notice' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( PRESSER_CONNECT_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function add_page() {
		add_options_page(
			__( 'KontrolWP Connect', 'presser-connect' ),
			__( 'KontrolWP Connect', 'presser-connect' ),
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::page_url() ) . '">' . esc_html__( 'Settings', 'presser-connect' ) . '</a>' );
		return $links;
	}

	/** On the Plugins screen, point to the key until KontrolWP has connected once. */
	public static function notice() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! current_user_can( 'manage_options' ) || ! $screen || 'plugins' !== $screen->id || get_option( Presser_Connect_Auth::LAST_SEEN_OPTION ) ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'KontrolWP Connect is ready.', 'presser-connect' ),
			esc_url( self::page_url() ),
			esc_html__( 'Copy the Connection Key into KontrolWP', 'presser-connect' )
		);
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$credentials = Presser_Connect_Auth::ensure_credentials();
		$key         = Presser_Connect_Auth::connection_key( $credentials );
		$last_seen   = (int) get_option( Presser_Connect_Auth::LAST_SEEN_OPTION, 0 );
		$message     = isset( $_GET['presser_message'] ) ? sanitize_key( wp_unslash( $_GET['presser_message'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'KontrolWP Connect', 'presser-connect' ); ?></h1>

			<?php if ( 'regenerated' === $message ) : ?>
				<div class="notice notice-success"><p><?php esc_html_e( 'New Connection Key created. Paste it into KontrolWP to reconnect this site.', 'presser-connect' ); ?></p></div>
			<?php endif; ?>

			<p><?php esc_html_e( 'In KontrolWP, select Add site, enter this site\'s address and paste this Connection Key. Treat it like a password: anyone with it can manage this site through KontrolWP.', 'presser-connect' ); ?></p>

			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="presser_connection_key"><?php esc_html_e( 'Connection Key', 'presser-connect' ); ?></label></th>
					<td>
						<textarea id="presser_connection_key" rows="3" class="large-text code" readonly onclick="this.select()"><?php echo esc_textarea( $key ); ?></textarea>
						<p>
							<button type="button" class="button" id="presser_copy_key"><?php esc_html_e( 'Copy', 'presser-connect' ); ?></button>
							<span id="presser_copied" class="description" hidden><?php esc_html_e( 'Copied', 'presser-connect' ); ?></span>
						</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Last contact from KontrolWP', 'presser-connect' ); ?></th>
					<td>
						<?php
						echo $last_seen
							? esc_html( sprintf( /* translators: %s: time since last contact */ __( '%s ago', 'presser-connect' ), human_time_diff( $last_seen ) ) )
							: esc_html__( 'Not yet', 'presser-connect' );
						?>
					</td>
				</tr>
			</table>

			<h2><?php esc_html_e( 'New Connection Key', 'presser-connect' ); ?></h2>
			<p><?php esc_html_e( 'Creates a new key and stops the current one from working. KontrolWP cannot reach this site until you paste the new key there.', 'presser-connect' ); ?></p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="presser_connect_regenerate" />
				<?php wp_nonce_field( 'presser_connect_regenerate' ); ?>
				<?php submit_button( __( 'Create a new key', 'presser-connect' ), 'secondary', 'submit', false ); ?>
			</form>
		</div>
		<script>
			document.getElementById( 'presser_copy_key' ).addEventListener( 'click', function () {
				var field = document.getElementById( 'presser_connection_key' );
				var done = function () { document.getElementById( 'presser_copied' ).hidden = false; };
				if ( navigator.clipboard && window.isSecureContext ) {
					navigator.clipboard.writeText( field.value ).then( done );
				} else {
					field.select();
					document.execCommand( 'copy' );
					done();
				}
			} );
		</script>
		<?php
	}

	public static function regenerate() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'presser-connect' ), 403 );
		}
		check_admin_referer( 'presser_connect_regenerate' );
		Presser_Connect_Auth::regenerate();
		wp_safe_redirect( add_query_arg( 'presser_message', 'regenerated', self::page_url() ) );
		exit;
	}

	private static function page_url() {
		return admin_url( 'options-general.php?page=' . self::PAGE );
	}
}
