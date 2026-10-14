<?php
/**
 * New posts from the dashboard (0.43.0): the Posts and pages tab's editor
 * writes a post or page here as HTML, with images uploaded to the media
 * library first, and saves it as a draft or publishes it.
 *
 * The request has no WordPress user, so the post is written as the author the
 * dashboard chose, and its HTML is saved as written (kses would otherwise strip
 * embeds the author is allowed to use).
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Posts {

	/** The largest image the dashboard may send, before the site's own upload limit. */
	const MAX_IMAGE_BYTES = 10485760;

	const IMAGE_TYPES = array(
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/gif'  => 'gif',
		'image/webp' => 'webp',
		'image/avif' => 'avif',
	);

	const STATUSES = array( 'draft', 'publish' );

	/** The most authors and categories the form offers. */
	const MAX_CHOICES = 500;

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/posts/form'   => 'form_route',
			'/posts/create' => 'create_route',
			'/media/upload' => 'upload_route',
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

	/**
	 * The new post from the request body, every field checked: array( 'type', 'title', 'content',
	 * 'status', 'author', 'categories', 'tags', 'featured' ), or a reason it cannot be saved as a string.
	 * $types are the slugs the form offered.
	 */
	public static function clean_post( $body, $types ) {
		if ( ! is_array( $body ) ) {
			return 'Send the post as JSON.';
		}
		$type = isset( $body['type'] ) ? (string) $body['type'] : 'post';
		if ( ! in_array( $type, $types, true ) ) {
			return 'This site has no content type called ' . $type . '.';
		}
		$status = isset( $body['status'] ) ? (string) $body['status'] : 'draft';
		if ( ! in_array( $status, self::STATUSES, true ) ) {
			return 'Send status as draft or publish.';
		}
		$title   = isset( $body['title'] ) && is_string( $body['title'] ) ? trim( $body['title'] ) : '';
		$content = isset( $body['content'] ) && is_string( $body['content'] ) ? trim( $body['content'] ) : '';
		if ( '' === $title && '' === $content ) {
			return 'Give the post a title or some content.';
		}
		if ( 'publish' === $status && '' === $title ) {
			return 'Give the post a title before publishing it.';
		}
		$ids = function ( $list ) {
			$list = is_array( $list ) ? $list : array();
			return array_values( array_unique( array_filter( array_map( 'intval', $list ), function ( $id ) {
				return $id > 0;
			} ) ) );
		};
		$tags = array();
		foreach ( isset( $body['tags'] ) && is_array( $body['tags'] ) ? $body['tags'] : array() as $tag ) {
			$tag = is_string( $tag ) ? trim( $tag ) : '';
			if ( '' !== $tag && ! in_array( $tag, $tags, true ) ) {
				$tags[] = $tag;
			}
		}
		$text = function ( $name ) use ( $body ) {
			return isset( $body[ $name ] ) && is_string( $body[ $name ] ) ? trim( $body[ $name ] ) : '';
		};
		// Only the SEO fields sent are set; the rest are left to the SEO settings' defaults.
		$seo  = array();
		$sent = isset( $body['seo'] ) && is_array( $body['seo'] ) ? $body['seo'] : array();
		foreach ( array( 'seo_title', 'description', 'keyword' ) as $name ) {
			if ( isset( $sent[ $name ] ) && is_string( $sent[ $name ] ) && '' !== trim( $sent[ $name ] ) ) {
				$seo[ $name ] = trim( $sent[ $name ] );
			}
		}
		if ( ! empty( $sent['noindex'] ) ) {
			$seo['noindex'] = true;
		}
		return array(
			'slug'       => $text( 'slug' ),
			'excerpt'    => $text( 'excerpt' ),
			'seo'        => $seo,
			'type'       => $type,
			'title'      => $title,
			'content'    => $content,
			'status'     => $status,
			'author'     => isset( $body['author'] ) ? max( 0, (int) $body['author'] ) : 0,
			'categories' => $ids( isset( $body['categories'] ) ? $body['categories'] : array() ),
			'tags'       => $tags,
			'featured'   => isset( $body['featured'] ) ? max( 0, (int) $body['featured'] ) : 0,
		);
	}

	/**
	 * The largest image, in bytes, the dashboard can upload: the site's own upload limit,
	 * and small enough that its base64 (a third larger) still fits in one request.
	 */
	public static function upload_limit( $wp_max, $post_max ) {
		$limits = array( self::MAX_IMAGE_BYTES );
		if ( (int) $wp_max > 0 ) {
			$limits[] = (int) $wp_max;
		}
		if ( (int) $post_max > 0 ) {
			// Base64 is 4 bytes for every 3, plus room for the rest of the request.
			$limits[] = max( 0, (int) floor( ( (int) $post_max - 65536 ) * 3 / 4 ) );
		}
		return min( $limits );
	}

	/**
	 * What an uploaded image is, from its bytes: array( 'mime', 'ext' ),
	 * or a reason it cannot be used as a string.
	 */
	public static function inspect( $bytes, $limit ) {
		$bytes = (string) $bytes;
		if ( '' === $bytes ) {
			return 'Choose an image to upload.';
		}
		if ( strlen( $bytes ) > $limit ) {
			return 'The image is larger than this site accepts (' . self::megabytes( $limit ) . ').';
		}
		$info = @getimagesizefromstring( $bytes ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		$mime = is_array( $info ) && isset( $info['mime'] ) ? $info['mime'] : '';
		if ( ! isset( self::IMAGE_TYPES[ $mime ] ) ) {
			return 'Upload a JPEG, PNG, GIF, WebP or AVIF image.';
		}
		return array(
			'mime' => $mime,
			'ext'  => self::IMAGE_TYPES[ $mime ],
		);
	}

	/** A file name for the media library: the one chosen, with the extension the bytes call for. */
	public static function file_name( $name, $ext ) {
		$base = preg_replace( '/\.[A-Za-z0-9]{1,5}$/', '', basename( str_replace( '\\', '/', (string) $name ) ) );
		$base = trim( preg_replace( '/[^A-Za-z0-9._-]+/', '-', $base ), '-.' );
		return ( '' === $base ? 'image' : substr( $base, 0, 80 ) ) . '.' . $ext;
	}

	private static function megabytes( $bytes ) {
		return rtrim( rtrim( number_format( $bytes / 1048576, 1, '.', '' ), '0' ), '.' ) . ' MB';
	}

	/* ---- WordPress ---- */

	/** The public content types that can be written in an editor. */
	private static function types() {
		$types = array();
		foreach ( get_post_types( array( 'public' => true ), 'objects' ) as $slug => $object ) {
			if ( 'attachment' === $slug || ! post_type_supports( $slug, 'editor' ) ) {
				continue;
			}
			$types[ $slug ] = $object;
		}
		uksort(
			$types,
			function ( $a, $b ) {
				$rank = array(
					'post' => 0,
					'page' => 1,
				);
				$ra   = isset( $rank[ $a ] ) ? $rank[ $a ] : 2;
				$rb   = isset( $rank[ $b ] ) ? $rank[ $b ] : 2;
				return $ra === $rb ? strcmp( $a, $b ) : $ra - $rb;
			}
		);
		return $types;
	}

	/** Who can write posts here, and who writes them when the dashboard names nobody. */
	private static function authors() {
		$users = get_users(
			array(
				'capability' => array( 'edit_posts' ),
				'orderby'    => 'display_name',
				'number'     => self::MAX_CHOICES,
				'fields'     => array( 'ID', 'display_name' ),
			)
		);
		$list  = array();
		foreach ( $users as $user ) {
			$list[] = array(
				'id'   => (int) $user->ID,
				'name' => html_entity_decode( $user->display_name, ENT_QUOTES, 'UTF-8' ),
			);
		}
		return $list;
	}

	private static function default_author() {
		$admins = get_users(
			array(
				'role'    => 'administrator',
				'orderby' => 'ID',
				'number'  => 1,
				'fields'  => 'ID',
			)
		);
		return $admins ? (int) $admins[0] : 0;
	}

	public static function max_upload() {
		return self::upload_limit( wp_max_upload_size(), wp_convert_hr_to_bytes( (string) ini_get( 'post_max_size' ) ) );
	}

	/** What the editor offers: content types, authors, categories and the upload limit. */
	public static function form_route() {
		$types = array();
		foreach ( self::types() as $slug => $object ) {
			$types[] = array(
				'slug'       => $slug,
				'singular'   => html_entity_decode( $object->labels->singular_name, ENT_QUOTES, 'UTF-8' ),
				'categories' => is_object_in_taxonomy( $slug, 'category' ),
				'tags'       => is_object_in_taxonomy( $slug, 'post_tag' ),
				'featured'   => post_type_supports( $slug, 'thumbnail' ) && current_theme_supports( 'post-thumbnails' ),
				'excerpt'    => post_type_supports( $slug, 'excerpt' ),
			);
		}
		$categories = array();
		foreach ( get_terms(
			array(
				'taxonomy'   => 'category',
				'hide_empty' => false,
				'number'     => self::MAX_CHOICES,
				'orderby'    => 'name',
			)
		) as $term ) {
			$categories[] = array(
				'id'     => (int) $term->term_id,
				'name'   => html_entity_decode( $term->name, ENT_QUOTES, 'UTF-8' ),
				'parent' => (int) $term->parent,
			);
		}
		return array(
			'types'          => $types,
			'authors'        => self::authors(),
			'default_author' => self::default_author(),
			'categories'     => $categories,
			'max_upload'     => self::max_upload(),
			// The SEO fields are saved either way; they show on the site while KontrolWP's SEO is on.
			'seo_active'     => KontrolWP_Connect_SEO::is_active(),
			// Where a post's slug goes, for the permalink preview: the address with %postname% in it.
			'permalinks'     => self::permalinks(),
		);
	}

	/**
	 * Each type's address with %postname% (or %pagename%) where the slug goes, or '' when
	 * the site uses plain ?p= addresses and a slug does not appear.
	 */
	private static function permalinks() {
		$out = array();
		if ( ! get_option( 'permalink_structure' ) ) {
			return (object) $out;
		}
		foreach ( array_keys( self::types() ) as $slug ) {
			$sample = new WP_Post(
				(object) array(
					'ID'          => -1,
					'post_type'   => $slug,
					'post_status' => 'publish',
					'post_name'   => 'kontrolwp-slug',
					'post_date'   => current_time( 'mysql' ),
					'filter'      => 'raw',
				)
			);
			try {
				$link = (string) get_permalink( $sample );
			} catch ( Throwable $error ) {
				$link = '';
			}
			$out[ $slug ] = false !== strpos( $link, 'kontrolwp-slug' ) ? str_replace( 'kontrolwp-slug', '%slug%', $link ) : '';
		}
		return (object) $out;
	}

	/**
	 * Body: { type, title, content (HTML), status: 'draft'|'publish', author?, categories?: int[], tags?: string[], featured?,
	 * slug?, excerpt?, seo?: { seo_title?, description?, keyword?, noindex? } }.
	 * Answers { id, status, permalink }.
	 */
	public static function create_route( $request ) {
		$post = self::clean_post( $request->get_json_params(), array_keys( self::types() ) );
		if ( is_string( $post ) ) {
			return new WP_Error( 'kontrolwp_invalid_post', $post, array( 'status' => 400 ) );
		}
		$author = $post['author'] ? get_userdata( $post['author'] ) : false;
		if ( ! $author || ! user_can( $author, 'edit_posts' ) ) {
			$author = get_userdata( self::default_author() );
		}
		if ( ! $author ) {
			return new WP_Error( 'kontrolwp_invalid_post', 'Choose who the post is by.', array( 'status' => 400 ) );
		}

		$data = array(
			'post_type'    => $post['type'],
			'post_title'   => $post['title'],
			'post_content' => $post['content'],
			'post_status'  => $post['status'],
			'post_author'  => $author->ID,
		);
		if ( '' !== $post['slug'] ) {
			$data['post_name'] = sanitize_title( $post['slug'] );
		}
		if ( '' !== $post['excerpt'] && post_type_supports( $post['type'], 'excerpt' ) ) {
			$data['post_excerpt'] = $post['excerpt'];
		}
		if ( $post['categories'] && is_object_in_taxonomy( $post['type'], 'category' ) ) {
			$data['post_category'] = $post['categories'];
		}
		if ( $post['tags'] && is_object_in_taxonomy( $post['type'], 'post_tag' ) ) {
			$data['tags_input'] = $post['tags'];
		}

		// Write as the author, so hooks that look at the current user see who wrote it.
		$previous = get_current_user_id();
		wp_set_current_user( $author->ID );
		$kses = false !== has_filter( 'content_save_pre', 'wp_filter_post_kses' );
		if ( $kses ) {
			kses_remove_filters();
		}
		$id = wp_insert_post( wp_slash( $data ), true );
		if ( $kses ) {
			kses_init_filters();
		}
		if ( ! is_wp_error( $id ) && $post['featured'] && 'attachment' === get_post_type( $post['featured'] ) ) {
			set_post_thumbnail( $id, $post['featured'] );
		}
		if ( ! is_wp_error( $id ) && $post['seo'] ) {
			KontrolWP_Connect_SEO::save_overrides( $id, $post['seo'] );
		}
		wp_set_current_user( $previous );

		if ( is_wp_error( $id ) ) {
			return new WP_Error( 'kontrolwp_post_failed', 'The post could not be saved: ' . $id->get_error_message(), array( 'status' => 500 ) );
		}
		return array(
			'id'        => (int) $id,
			'status'    => get_post_status( $id ),
			'permalink' => (string) get_permalink( $id ),
		);
	}

	/**
	 * Body: { name, image: base64, alt? }. Adds the image to the media library and answers
	 * { id, url, src, width, height }: src is the large size for the post body, url the original.
	 */
	public static function upload_route( $request ) {
		$body  = $request->get_json_params();
		$body  = is_array( $body ) ? $body : array();
		$bytes = isset( $body['image'] ) ? base64_decode( (string) $body['image'], true ) : '';
		$info  = false === $bytes ? 'The image could not be read. Choose it again.' : self::inspect( $bytes, self::max_upload() );
		if ( is_string( $info ) ) {
			return new WP_Error( 'kontrolwp_invalid_image', $info, array( 'status' => 400 ) );
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$name   = self::file_name( isset( $body['name'] ) ? $body['name'] : '', $info['ext'] );
		$stored = wp_upload_bits( $name, null, $bytes );
		if ( ! empty( $stored['error'] ) ) {
			return new WP_Error( 'kontrolwp_upload_failed', 'The image could not be saved on the site: ' . $stored['error'], array( 'status' => 500 ) );
		}
		$id = wp_insert_attachment(
			array(
				'post_title'     => preg_replace( '/\.[^.]+$/', '', $name ),
				'post_mime_type' => $info['mime'],
				'post_status'    => 'inherit',
			),
			$stored['file'],
			0,
			true
		);
		if ( is_wp_error( $id ) ) {
			wp_delete_file( $stored['file'] );
			return new WP_Error( 'kontrolwp_upload_failed', 'The image could not be added to the media library.', array( 'status' => 500 ) );
		}
		wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $stored['file'] ) );
		$alt = isset( $body['alt'] ) && is_string( $body['alt'] ) ? trim( $body['alt'] ) : '';
		if ( '' !== $alt ) {
			update_post_meta( $id, '_wp_attachment_image_alt', sanitize_text_field( $alt ) );
		}

		$large = wp_get_attachment_image_src( $id, 'large' );
		return array(
			'id'     => (int) $id,
			'url'    => (string) wp_get_attachment_url( $id ),
			'src'    => $large ? (string) $large[0] : (string) wp_get_attachment_url( $id ),
			'width'  => $large ? (int) $large[1] : 0,
			'height' => $large ? (int) $large[2] : 0,
		);
	}
}
