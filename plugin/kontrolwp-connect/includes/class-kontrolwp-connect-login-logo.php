<?php
/**
 * Login page logo (0.32.0): show the site's own logo above the WordPress
 * login form instead of the WordPress logo, linking to the site's home page.
 *
 * The image is uploaded from the dashboard and kept in the media library. The
 * only other thing stored is one option, so turning this off or deactivating
 * the plugin puts the WordPress logo back at once. It works on the custom
 * login address too, because that serves the same wp-login.php.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Login_Logo {

	/** Holds array( 'enabled' => bool, 'size' => 'small'|'medium'|'large', 'attachment' => int, 'width' => int, 'height' => int ). */
	const OPTION = 'kontrolwp_connect_login_logo';

	/** Marks the media library item this feature uploaded, so it is only ever this one that gets replaced or removed. */
	const META = '_kontrolwp_login_logo';

	const MAX_BYTES = 1048576;

	/** The largest box the logo is drawn in, in CSS pixels, for each size. The login form is 320 pixels wide. */
	const BOXES = array(
		'small'  => array( 84, 84 ),
		'medium' => array( 200, 100 ),
		'large'  => array( 320, 140 ),
	);

	const TYPES = array(
		'image/png'  => 'png',
		'image/jpeg' => 'jpg',
		'image/gif'  => 'gif',
		'image/webp' => 'webp',
	);

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/login-logo'      => 'report_route',
			'/login-logo/save' => 'save_route',
		) as $path => $method ) {
			register_rest_route(
				$ns,
				$path,
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, $method ),
					'permission_callback' => $auth,
				)
			);
		}
	}

	/* ---- Pure helpers (tested outside WordPress) ---- */

	/** The saved setting with every field present and clean. */
	public static function clean( $stored ) {
		$stored = is_array( $stored ) ? $stored : array();
		$size   = isset( $stored['size'] ) ? (string) $stored['size'] : '';
		return array(
			'enabled'    => ! empty( $stored['enabled'] ),
			'size'       => isset( self::BOXES[ $size ] ) ? $size : 'medium',
			'attachment' => isset( $stored['attachment'] ) ? max( 0, (int) $stored['attachment'] ) : 0,
			'width'      => isset( $stored['width'] ) ? max( 0, (int) $stored['width'] ) : 0,
			'height'     => isset( $stored['height'] ) ? max( 0, (int) $stored['height'] ) : 0,
		);
	}

	/**
	 * The drawn size of an image of $width by $height in the box for $size:
	 * as large as fits, keeping its shape, and never larger than the image.
	 */
	public static function fit( $width, $height, $size ) {
		$width  = (int) $width;
		$height = (int) $height;
		$box    = isset( self::BOXES[ $size ] ) ? self::BOXES[ $size ] : self::BOXES['medium'];
		if ( $width <= 0 || $height <= 0 ) {
			return array( $box[0], $box[1] );
		}
		$scale = min( 1, $box[0] / $width, $box[1] / $height );
		return array( max( 1, (int) round( $width * $scale ) ), max( 1, (int) round( $height * $scale ) ) );
	}

	/**
	 * What an uploaded image is, from its bytes: array( 'mime', 'ext', 'width', 'height' ),
	 * or a reason it cannot be used as a string.
	 */
	public static function inspect( $bytes ) {
		$bytes = (string) $bytes;
		if ( '' === $bytes ) {
			return 'Choose an image to upload.';
		}
		if ( strlen( $bytes ) > self::MAX_BYTES ) {
			return 'The logo can be up to 1 MB.';
		}
		$info = @getimagesizefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		$mime = is_array( $info ) && isset( $info['mime'] ) ? $info['mime'] : '';
		if ( ! isset( self::TYPES[ $mime ] ) ) {
			return 'The logo must be a PNG, JPEG, GIF or WebP image.';
		}
		if ( (int) $info[0] < 1 || (int) $info[1] < 1 ) {
			return 'The image has no size. Choose another file.';
		}
		return array(
			'mime'   => $mime,
			'ext'    => self::TYPES[ $mime ],
			'width'  => (int) $info[0],
			'height' => (int) $info[1],
		);
	}

	/** The CSS that swaps the logo, for an escaped image URL and a drawn size. */
	public static function css( $url, $width, $height ) {
		return '#login h1 a, .login h1 a {'
			. ' background-image: url("' . $url . '"); background-size: contain; background-position: center; background-repeat: no-repeat;'
			. ' width: ' . (int) $width . 'px; height: ' . (int) $height . 'px; max-width: 100%; }';
	}

	/* ---- WordPress ---- */

	public static function settings() {
		return self::clean( get_option( self::OPTION, array() ) );
	}

	/** The uploaded logo's address, or '' when there is none. */
	private static function logo_url( $settings ) {
		if ( ! $settings['attachment'] ) {
			return '';
		}
		$url = wp_get_attachment_url( $settings['attachment'] );
		return $url ? (string) $url : '';
	}

	/** Whether the logo is in force right now. */
	public static function active() {
		$settings = self::settings();
		return $settings['enabled'] && '' !== self::logo_url( $settings );
	}

	public static function boot() {
		if ( ! self::active() ) {
			return;
		}
		add_action( 'login_enqueue_scripts', array( __CLASS__, 'print_style' ) );
		add_filter( 'login_headerurl', array( __CLASS__, 'header_url' ) );
		add_filter( 'login_headertext', array( __CLASS__, 'header_text' ) );
	}

	public static function print_style() {
		$settings = self::settings();
		$size     = self::fit( $settings['width'], $settings['height'], $settings['size'] );
		echo '<style id="kontrolwp-login-logo">' . self::css( esc_url( self::logo_url( $settings ) ), $size[0], $size[1] ) . "</style>\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	public static function header_url() {
		return home_url( '/' );
	}

	public static function header_text() {
		return get_bloginfo( 'name', 'display' );
	}

	public static function report() {
		$settings = self::settings();
		$url      = self::logo_url( $settings );
		$size     = self::fit( $settings['width'], $settings['height'], $settings['size'] );
		return array(
			'enabled'  => $settings['enabled'],
			'size'     => $settings['size'],
			'logo_url' => $url,
			'width'    => $url ? $settings['width'] : 0,
			'height'   => $url ? $settings['height'] : 0,
			'drawn'    => $url ? array( 'width' => $size[0], 'height' => $size[1] ) : null,
			'active'   => $settings['enabled'] && '' !== $url,
		);
	}

	public static function report_route() {
		return self::report();
	}

	/** Remove the media library item this feature uploaded, and nothing else. */
	private static function delete_upload( $id ) {
		$id = (int) $id;
		if ( $id && get_post_meta( $id, self::META, true ) ) {
			wp_delete_attachment( $id, true );
		}
	}

	/** Put an image in the media library: the new attachment's id, or a WP_Error. */
	private static function upload( $bytes, $info ) {
		$name   = sanitize_file_name( 'login-logo-' . gmdate( 'YmdHis' ) . '.' . $info['ext'] );
		$stored = wp_upload_bits( $name, null, $bytes );
		if ( ! empty( $stored['error'] ) ) {
			return new WP_Error( 'kontrolwp_login_logo_upload', 'The logo could not be saved on the site: ' . $stored['error'], array( 'status' => 500 ) );
		}
		$id = wp_insert_attachment(
			array(
				'post_title'     => 'Login page logo',
				'post_mime_type' => $info['mime'],
				'post_status'    => 'inherit',
			),
			$stored['file'],
			0,
			true
		);
		if ( is_wp_error( $id ) ) {
			wp_delete_file( $stored['file'] );
			return new WP_Error( 'kontrolwp_login_logo_upload', 'The logo could not be added to the media library.', array( 'status' => 500 ) );
		}
		update_post_meta( $id, self::META, 1 );
		require_once ABSPATH . 'wp-admin/includes/image.php';
		wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $stored['file'] ) );
		return $id;
	}

	/**
	 * Body: { enabled: bool, size: 'small'|'medium'|'large', image?: base64, remove?: bool }.
	 * A new image replaces the old one; remove takes it away and turns the logo off.
	 */
	public static function save_route( $request ) {
		$body = $request->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['enabled'] ) || ! is_bool( $body['enabled'] ) ) {
			return new WP_Error( 'kontrolwp_invalid_login_logo', 'Send enabled as true or false.', array( 'status' => 400 ) );
		}
		$old = self::settings();
		$new = self::clean( array_merge( $old, array( 'enabled' => $body['enabled'], 'size' => isset( $body['size'] ) ? $body['size'] : $old['size'] ) ) );

		if ( ! empty( $body['remove'] ) ) {
			self::delete_upload( $old['attachment'] );
			$new = array_merge( $new, array( 'enabled' => false, 'attachment' => 0, 'width' => 0, 'height' => 0 ) );
		} elseif ( isset( $body['image'] ) && '' !== $body['image'] ) {
			$bytes = base64_decode( (string) $body['image'], true );
			$info  = false === $bytes ? 'The image could not be read. Choose it again.' : self::inspect( $bytes );
			if ( is_string( $info ) ) {
				return new WP_Error( 'kontrolwp_invalid_login_logo', $info, array( 'status' => 400 ) );
			}
			$id = self::upload( $bytes, $info );
			if ( is_wp_error( $id ) ) {
				return $id;
			}
			self::delete_upload( $old['attachment'] );
			$new = array_merge( $new, array( 'attachment' => $id, 'width' => $info['width'], 'height' => $info['height'] ) );
		}

		if ( $new['enabled'] && '' === self::logo_url( $new ) ) {
			return new WP_Error( 'kontrolwp_invalid_login_logo', 'Upload a logo first.', array( 'status' => 400 ) );
		}
		update_option( self::OPTION, $new, true );
		return self::report();
	}

	/** On uninstall: the uploaded logo goes with the plugin. */
	public static function delete_all() {
		self::delete_upload( self::settings()['attachment'] );
		delete_option( self::OPTION );
	}
}
