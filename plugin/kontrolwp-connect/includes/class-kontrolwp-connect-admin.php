<?php
/**
 * Settings, KontrolWP Connect: where the owner copies this site's Connection Key.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Admin {

	const PAGE = 'kontrolwp-connect';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'add_page' ) );
		add_action( 'admin_post_kontrolwp_connect_regenerate', array( __CLASS__, 'regenerate' ) );
		add_action( 'admin_notices', array( __CLASS__, 'notice' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( KONTROLWP_CONNECT_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function add_page() {
		add_options_page(
			__( 'KontrolWP Connect', 'kontrolwp-connect' ),
			__( 'KontrolWP Connect', 'kontrolwp-connect' ),
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( self::page_url() ) . '">' . esc_html__( 'Settings', 'kontrolwp-connect' ) . '</a>' );
		return $links;
	}

	/** On the Plugins screen, point to the key until KontrolWP has connected once. */
	public static function notice() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! current_user_can( 'manage_options' ) || ! $screen || 'plugins' !== $screen->id || get_option( KontrolWP_Connect_Auth::LAST_SEEN_OPTION ) ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%s <a href="%s">%s</a></p></div>',
			esc_html__( 'KontrolWP Connect is ready.', 'kontrolwp-connect' ),
			esc_url( self::page_url() ),
			esc_html__( 'Copy the Connection Key into KontrolWP', 'kontrolwp-connect' )
		);
	}

	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$credentials = KontrolWP_Connect_Auth::ensure_credentials();
		$key         = KontrolWP_Connect_Auth::connection_key( $credentials );
		$last_seen   = (int) get_option( KontrolWP_Connect_Auth::LAST_SEEN_OPTION, 0 );
		$site_url    = home_url();
		$message     = isset( $_GET['kontrolwp_message'] ) ? sanitize_key( wp_unslash( $_GET['kontrolwp_message'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		self::styles();
		?>
		<div class="wrap kwp">
			<header class="kwp-header">
				<span class="kwp-mark" aria-hidden="true">K</span>
				<div>
					<h1><?php esc_html_e( 'KontrolWP Connect', 'kontrolwp-connect' ); ?></h1>
					<p class="kwp-muted">
						<?php
						/* translators: %s: plugin version */
						echo esc_html( sprintf( __( 'Version %s', 'kontrolwp-connect' ), KONTROLWP_CONNECT_VERSION ) );
						?>
					</p>
				</div>
				<?php if ( $last_seen ) : ?>
					<span class="kwp-pill kwp-pill-on">
						<?php
						/* translators: %s: time since last contact, such as "3 mins" */
						echo esc_html( sprintf( __( 'Connected, last contact %s ago', 'kontrolwp-connect' ), human_time_diff( $last_seen ) ) );
						?>
					</span>
				<?php else : ?>
					<span class="kwp-pill"><?php esc_html_e( 'Not connected yet', 'kontrolwp-connect' ); ?></span>
				<?php endif; ?>
			</header>
			<hr class="wp-header-end" />

			<?php if ( 'regenerated' === $message ) : ?>
				<div class="notice notice-success"><p><?php esc_html_e( 'New Connection Key created. Paste it into KontrolWP to reconnect this site.', 'kontrolwp-connect' ); ?></p></div>
			<?php endif; ?>

			<section class="kwp-card">
				<h2><?php echo $last_seen ? esc_html__( 'Connection Key', 'kontrolwp-connect' ) : esc_html__( 'Connect this site', 'kontrolwp-connect' ); ?></h2>
				<?php if ( ! $last_seen ) : ?>
					<ol class="kwp-steps">
						<li><?php esc_html_e( 'In KontrolWP, select Add site.', 'kontrolwp-connect' ); ?></li>
						<li><?php esc_html_e( 'Enter this site\'s address and paste the Connection Key below.', 'kontrolwp-connect' ); ?></li>
					</ol>
				<?php else : ?>
					<p class="kwp-muted"><?php esc_html_e( 'KontrolWP uses this key to reach the site. You only need it again to reconnect.', 'kontrolwp-connect' ); ?></p>
				<?php endif; ?>

				<div class="kwp-field">
					<span class="kwp-label"><?php esc_html_e( 'Site address', 'kontrolwp-connect' ); ?></span>
					<div class="kwp-value">
						<code id="kwp-site-url"><?php echo esc_html( $site_url ); ?></code>
						<button type="button" class="button kwp-copy" data-copy="kwp-site-url"><?php esc_html_e( 'Copy', 'kontrolwp-connect' ); ?></button>
					</div>
				</div>
				<div class="kwp-field">
					<label class="kwp-label" for="kwp-key"><?php esc_html_e( 'Connection Key', 'kontrolwp-connect' ); ?></label>
					<div class="kwp-value">
						<input id="kwp-key" type="password" class="kwp-key code" value="<?php echo esc_attr( $key ); ?>" readonly autocomplete="off" spellcheck="false" />
						<button type="button" class="button" id="kwp-reveal" aria-controls="kwp-key"><?php esc_html_e( 'Show', 'kontrolwp-connect' ); ?></button>
						<button type="button" class="button button-primary kwp-copy" data-copy="kwp-key"><?php esc_html_e( 'Copy key', 'kontrolwp-connect' ); ?></button>
					</div>
					<p class="kwp-hint"><?php esc_html_e( 'Treat it like a password: anyone with it can manage this site through KontrolWP.', 'kontrolwp-connect' ); ?></p>
				</div>
				<p class="kwp-copied screen-reader-text" role="status" aria-live="polite"></p>
			</section>

			<section class="kwp-card kwp-danger">
				<div>
					<h2><?php esc_html_e( 'Replace the Connection Key', 'kontrolwp-connect' ); ?></h2>
					<p class="kwp-muted"><?php esc_html_e( 'Use this if the key was shared by mistake. The current key stops working at once, and KontrolWP can\'t reach this site until you paste the new one there.', 'kontrolwp-connect' ); ?></p>
				</div>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="kwp-regenerate">
					<input type="hidden" name="action" value="kontrolwp_connect_regenerate" />
					<?php wp_nonce_field( 'kontrolwp_connect_regenerate' ); ?>
					<button type="submit" class="button kwp-button-danger"><?php esc_html_e( 'Replace key', 'kontrolwp-connect' ); ?></button>
				</form>
			</section>
		</div>
		<script>
			( function () {
				var status = document.querySelector( '.kwp-copied' );
				var key = document.getElementById( 'kwp-key' );
				var reveal = document.getElementById( 'kwp-reveal' );
				reveal.addEventListener( 'click', function () {
					var hidden = key.type === 'password';
					key.type = hidden ? 'text' : 'password';
					reveal.textContent = hidden ? <?php echo wp_json_encode( __( 'Hide', 'kontrolwp-connect' ) ); ?> : <?php echo wp_json_encode( __( 'Show', 'kontrolwp-connect' ) ); ?>;
				} );
				document.querySelectorAll( '.kwp-copy' ).forEach( function ( button ) {
					button.addEventListener( 'click', function () {
						var source = document.getElementById( button.getAttribute( 'data-copy' ) );
						var text = 'value' in source ? source.value : source.textContent;
						var done = function () {
							var label = button.textContent;
							button.textContent = <?php echo wp_json_encode( __( 'Copied', 'kontrolwp-connect' ) ); ?>;
							status.textContent = <?php echo wp_json_encode( __( 'Copied to the clipboard.', 'kontrolwp-connect' ) ); ?>;
							setTimeout( function () { button.textContent = label; status.textContent = ''; }, 2000 );
						};
						if ( navigator.clipboard && window.isSecureContext ) {
							navigator.clipboard.writeText( text ).then( done );
						} else {
							var area = document.createElement( 'textarea' );
							area.value = text;
							document.body.appendChild( area );
							area.select();
							document.execCommand( 'copy' );
							area.remove();
							done();
						}
					} );
				} );
				document.getElementById( 'kwp-regenerate' ).addEventListener( 'submit', function ( event ) {
					if ( ! window.confirm( <?php echo wp_json_encode( __( 'Replace the Connection Key? KontrolWP loses access to this site until you paste the new key there.', 'kontrolwp-connect' ) ); ?> ) ) {
						event.preventDefault();
					}
				} );
			}() );
		</script>
		<?php
	}

	/** The page's look: plain cards in the style of the KontrolWP dashboard, within wp-admin. */
	private static function styles() {
		?>
		<style>
			.kwp { max-width: 760px; }
			.kwp-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0 20px; }
			.kwp-header h1 { padding: 0; margin: 0; font-size: 22px; line-height: 1.3; }
			.kwp-header p { margin: 0; }
			.kwp-mark { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 10px; background: #18181b; color: #fff; font-size: 20px; font-weight: 700; }
			.kwp-pill { margin-left: auto; padding: 4px 10px; border-radius: 999px; background: #f0f0f1; color: #50575e; font-size: 12px; font-weight: 500; }
			.kwp-pill-on { background: #e7f6ec; color: #116329; }
			.kwp-card { margin: 0 0 16px; padding: 20px 24px; border: 1px solid #dcdcde; border-radius: 12px; background: #fff; }
			.kwp-card h2 { margin: 0 0 4px; font-size: 15px; }
			.kwp-muted, .kwp-hint { margin: 0; color: #646970; }
			.kwp-hint { margin-top: 6px; font-size: 12px; }
			.kwp-steps { margin: 8px 0 0 18px; color: #3c434a; }
			.kwp-steps li { margin-bottom: 2px; }
			.kwp-field { margin-top: 18px; }
			.kwp-label { display: block; margin-bottom: 6px; font-weight: 600; }
			.kwp-value { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
			.kwp-value code { flex: 1 1 220px; min-width: 0; padding: 6px 10px; border: 1px solid #dcdcde; border-radius: 6px; background: #f6f7f7; overflow-wrap: anywhere; }
			.kwp-key { flex: 1 1 220px; min-width: 0; font-size: 13px; background: #f6f7f7 !important; }
			.kwp-danger { display: flex; gap: 16px 24px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
			.kwp-danger > div { flex: 1 1 320px; }
			.kwp .kwp-button-danger { border-color: #d63638; color: #b32d2e; }
			.kwp .kwp-button-danger:hover, .kwp .kwp-button-danger:focus { border-color: #b32d2e; background: #fcf0f1; color: #8a2424; }
		</style>
		<?php
	}

	public static function regenerate() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do that.', 'kontrolwp-connect' ), 403 );
		}
		check_admin_referer( 'kontrolwp_connect_regenerate' );
		KontrolWP_Connect_Auth::regenerate();
		wp_safe_redirect( add_query_arg( 'kontrolwp_message', 'regenerated', self::page_url() ) );
		exit;
	}

	private static function page_url() {
		return admin_url( 'options-general.php?page=' . self::PAGE );
	}
}
