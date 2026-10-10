<?php
/**
 * Login page logo (0.32.0): show the site's own logo above the WordPress
 * login form instead of the WordPress logo, linking to the site's home page.
 *
 * The logo is either the one already set in WordPress (the theme's Site Logo,
 * or the Site Icon when there is none; 0.33.0), or an image uploaded from the
 * dashboard and kept in the media library. The only other thing stored is one
 * option, so turning this off or deactivating
 * the plugin puts the WordPress logo back at once. It works on the custom
 * login address too, because that serves the same wp-login.php.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Login_Logo {

	/**
	 * Holds array( 'enabled' => bool, 'source' => 'upload'|'site', 'size' => 'small'|'medium'|'large',
	 * 'attachment' => int, 'width' => int, 'height' => int ). The attachment and its size are the uploaded image.
	 */
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
			// Before 0.33.0 only an upload existed, so a setting without a source keeps its upload.
			'source'     => isset( $stored['source'] ) && in_array( $stored['source'], array( 'site', 'upload' ), true )
				? $stored['source']
				: ( empty( $stored['attachment'] ) ? 'site' : 'upload' ),
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

	/** The uploaded logo: array( url, width, height ), with '' as the url when there is none. */
	public static function uploaded( $settings ) {
		$url = $settings['attachment'] ? wp_get_attachment_url( $settings['attachment'] ) : '';
		return array( $url ? (string) $url : '', $settings['width'], $settings['height'] );
	}

	/**
	 * The logo already set in WordPress: the Site Logo (custom_logo, which block
	 * themes keep in step with site_logo), else the Site Icon. array( url, width, height, kind ),
	 * with '' as the url and kind when the site has neither.
	 */
	public static function site_logo() {
		foreach ( array(
			'logo' => array( (int) get_theme_mod( 'custom_logo' ), (int) get_option( 'site_logo' ) ),
			'icon' => array( (int) get_option( 'site_icon' ) ),
		) as $kind => $ids ) {
			foreach ( $ids as $id ) {
				$image = $id ? wp_get_attachment_image_src( $id, 'full' ) : false;
				if ( $image && ! empty( $image[0] ) ) {
					return array( (string) $image[0], (int) $image[1], (int) $image[2], $kind );
				}
			}
		}
		return array( '', 0, 0, '' );
	}

	/** The logo for the chosen source: array( url, width, height ). */
	private static function current( $settings ) {
		return 'site' === $settings['source'] ? array_slice( self::site_logo(), 0, 3 ) : self::uploaded( $settings );
	}

	/** Whether the logo is in force right now. */
	public static function active() {
		$settings = self::settings();
		$logo     = self::current( $settings );
		return $settings['enabled'] && '' !== $logo[0];
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
		$logo     = self::current( $settings );
		$size     = self::fit( $logo[1], $logo[2], $settings['size'] );
		echo '<style id="kontrolwp-login-logo">' . self::css( esc_url( $logo[0] ), $size[0], $size[1] ) . "</style>\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	}

	public static function header_url() {
		return home_url( '/' );
	}

	public static function header_text() {
		return get_bloginfo( 'name', 'display' );
	}

	public static function report() {
		$settings = self::settings();
		$logo     = self::current( $settings );
		$upload   = self::uploaded( $settings );
		$site     = self::site_logo();
		$size     = self::fit( $logo[1], $logo[2], $settings['size'] );
		return array(
			'enabled'        => $settings['enabled'],
			'source'         => $settings['source'],
			'size'           => $settings['size'],
			'logo_url'       => $logo[0],
			'width'          => $logo[0] ? $logo[1] : 0,
			'height'         => $logo[0] ? $logo[2] : 0,
			'drawn'          => $logo[0] ? array( 'width' => $size[0], 'height' => $size[1] ) : null,
			'active'         => $settings['enabled'] && '' !== $logo[0],
			'upload_url'     => $upload[0],
			'site_logo_url'  => $site[0],
			'site_logo_kind' => $site[3],
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
	 * Body: { enabled: bool, size: 'small'|'medium'|'large', source?: 'upload'|'site', image?: base64, remove?: bool }.
	 * A new image replaces the old one and selects it; remove takes it away, and turns the logo off when it was in use.
	 */
	public static function save_route( $request ) {
		$body = $request->get_json_params();
		if ( ! is_array( $body ) || ! isset( $body['enabled'] ) || ! is_bool( $body['enabled'] ) ) {
			return new WP_Error( 'kontrolwp_invalid_login_logo', 'Send enabled as true or false.', array( 'status' => 400 ) );
		}
		$old = self::settings();
		$new = self::clean(
			array_merge(
				$old,
				array(
					'enabled' => $body['enabled'],
					'size'    => isset( $body['size'] ) ? $body['size'] : $old['size'],
					'source'  => isset( $body['source'] ) ? $body['source'] : $old['source'],
				)
			)
		);

		if ( ! empty( $body['remove'] ) ) {
			self::delete_upload( $old['attachment'] );
			$new = array_merge( $new, array( 'attachment' => 0, 'width' => 0, 'height' => 0 ) );
			if ( 'upload' === $new['source'] ) {
				$new['enabled'] = false;
			}
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
			$new = array_merge( $new, array( 'source' => 'upload', 'attachment' => $id, 'width' => $info['width'], 'height' => $info['height'] ) );
		}

		$logo = self::current( $new );
		if ( $new['enabled'] && '' === $logo[0] ) {
			$message = 'site' === $new['source'] ? 'This site has no logo or site icon set in WordPress. Set one, or upload a logo instead.' : 'Upload a logo first.';
			return new WP_Error( 'kontrolwp_invalid_login_logo', $message, array( 'status' => 400 ) );
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
