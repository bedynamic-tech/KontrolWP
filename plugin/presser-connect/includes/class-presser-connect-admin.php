<?php
/**
 * Settings, Presser Connect: where the owner pastes the Connection Key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Admin {

	const PAGE = 'presser-connect';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_post_presser_connect_save', array( __CLASS__, 'save' ) );
		add_action( 'admin_post_presser_connect_disconnect', array( __CLASS__, 'disconnect' ) );
		add_action( 'admin_notices', array( __CLASS__, 'notice' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( PRESSER_CONNECT_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function add_page() {
		add_options_page(
			__( 'Presser Connect', 'presser-connect' ),
			__( 'Presser Connect', 'presser-connect' ),
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::page_url() ) . '">' . esc_html__( 'Settings', 'presser-connect' ) . '</a>' );
		return $links;
	}

	public static function notice() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! current_user_can( 'manage_options' ) || ! $screen || 'plugins' !== $screen->id || Presser_Connect_Auth::connection() ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'Presser Connect is almost ready.', 'presser-connect' ),
			esc_url( self::page_url() ),
			esc_html__( 'Paste your Connection Key', 'presser-connect' )
		);
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$connection = Presser_Connect_Auth::connection();
		$last_seen  = (int) get_option( Presser_Connect_Auth::LAST_SEEN_OPTION, 0 );
		$message    = isset( $_GET['presser_message'] ) ? sanitize_key( wp_unslash( $_GET['presser_message'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$error      = get_transient( 'presser_connect_error_' . get_current_user_id() );
		delete_transient( 'presser_connect_error_' . get_current_user_id() );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Presser Connect', 'presser-connect' ); ?></h1>

			<?php if ( $error ) : ?>
				<div class="notice notice-error"><p><?php echo esc_html( $error ); ?></p></div>
			<?php elseif ( 'connected' === $message ) : ?>
				<div class="notice notice-success"><p><?php esc_html_e( 'Connected. Select Sync now in your Presser dashboard to finish.', 'presser-connect' ); ?></p></div>
			<?php elseif ( 'disconnected' === $message ) : ?>
				<div class="notice notice-success"><p><?php esc_html_e( 'Disconnected. Presser can no longer reach this site.', 'presser-connect' ); ?></p></div>
			<?php endif; ?>

			<?php if ( $connection ) : ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Dashboard', 'presser-connect' ); ?></th>
						<td><a href="<?php echo esc_url( $connection['dashboard'] ); ?>" target="_blank" rel="noreferrer"><?php echo esc_html( $connection['dashboard'] ); ?></a></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Last contact', 'presser-connect' ); ?></th>
						<td>
							<?php
							echo $last_seen
								? esc_html( sprintf( /* translators: %s: time since last contact */ __( '%s ago', 'presser-connect' ), human_time_diff( $last_seen ) ) )
								: esc_html__( 'Not yet', 'presser-connect' );
							?>
						</td>
					</tr>
				</table>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="presser_connect_disconnect" />
					<?php wp_nonce_field( 'presser_connect_disconnect' ); ?>
					<?php submit_button( __( 'Disconnect', 'presser-connect' ), 'secondary' ); ?>
				</form>
				<h2><?php esc_html_e( 'Replace the Connection Key', 'presser-connect' ); ?></h2>
			<?php else : ?>
				<p><?php esc_html_e( 'In your Presser dashboard, add this site and copy its Connection Key. Paste it below.', 'presser-connect' ); ?></p>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="presser_connect_save" />
				<?php wp_nonce_field( 'presser_connect_save' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="presser_connection_key"><?php esc_html_e( 'Connection Key', 'presser-connect' ); ?></label></th>
						<td>
							<textarea id="presser_connection_key" name="presser_connection_key" rows="4" class="large-text code" autocomplete="off" spellcheck="false" required></textarea>
							<p class="description"><?php esc_html_e( 'Treat it like a password. Anyone with it can manage this site through Presser.', 'presser-connect' ); ?></p>
						</td>
					</tr>
				</table>
				<?php submit_button( __( 'Connect', 'presser-connect' ) ); ?>
			</form>
		</div>
		<?php
	}

	public static function save() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'presser-connect' ), 403 );
		}
		check_admin_referer( 'presser_connect_save' );

		$key    = isset( $_POST['presser_connection_key'] ) ? sanitize_text_field( wp_unslash( $_POST['presser_connection_key'] ) ) : '';
		$parsed = Presser_Connect_Auth::parse_connection_key( $key );
		if ( is_wp_error( $parsed ) ) {
			set_transient( 'presser_connect_error_' . get_current_user_id(), $parsed->get_error_message(), 60 );
			wp_safe_redirect( self::page_url() );
			exit;
		}

		$parsed['connected_at'] = time();
		update_option( Presser_Connect_Auth::OPTION, $parsed, false );
		delete_option( Presser_Connect_Auth::LAST_SEEN_OPTION );
		wp_safe_redirect( add_query_arg( 'presser_message', 'connected', self::page_url() ) );
		exit;
	}

	public static function disconnect() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'presser-connect' ), 403 );
		}
		check_admin_referer( 'presser_connect_disconnect' );
		delete_option( Presser_Connect_Auth::OPTION );
		delete_option( Presser_Connect_Auth::LAST_SEEN_OPTION );
		wp_safe_redirect( add_query_arg( 'presser_message', 'disconnected', self::page_url() ) );
		exit;
	}

	private static function page_url() {
		return admin_url( 'options-general.php?page=' . self::PAGE );
	}
}
