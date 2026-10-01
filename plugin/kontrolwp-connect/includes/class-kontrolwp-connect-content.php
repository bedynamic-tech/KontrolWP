<?php
/**
 * This site's posts and pages, for the dashboard's Posts and pages tab: a
 * read-only, filterable list, one page at a time. Titles and statuses come
 * straight from WordPress, and nothing is changed.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Content {

	/** Most items one page returns. */
	const MAX_PER_PAGE = 100;

	/** The statuses the list covers, in the order the dashboard shows them. Trash and auto-drafts are left out. */
	const STATUSES = array( 'publish', 'future', 'draft', 'pending', 'private' );

	const TYPES = array( 'post', 'page' );

	public static function register_routes( $auth ) {
		register_rest_route(
			KontrolWP_Connect_Rest::NAMESPACE_V1,
			'/content',
			array(
				// POST so the filters are in the signed body.
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'index' ),
				'permission_callback' => $auth,
				'args'                => array(
					'page'     => array(
						'type'    => 'integer',
						'minimum' => 1,
						'default' => 1,
					),
					'per_page' => array(
						'type'    => 'integer',
						'minimum' => 1,
						'maximum' => self::MAX_PER_PAGE,
						'default' => 25,
					),
					// "all", or one of the types above.
					'type'     => array(
						'type'    => 'string',
						'default' => 'all',
					),
					// "all", or one of the statuses above.
					'status'   => array(
						'type'    => 'string',
						'default' => 'all',
					),
					'search'   => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);
	}

	/** How many of each status there are, for the chosen type. */
	private static function counts( $types ) {
		$counts = array_fill_keys( self::STATUSES, 0 );
		foreach ( $types as $type ) {
			$by_status = wp_count_posts( $type );
			foreach ( self::STATUSES as $status ) {
				if ( isset( $by_status->$status ) ) {
					$counts[ $status ] += (int) $by_status->$status;
				}
			}
		}
		return $counts;
	}

	public static function index( $request ) {
		$type   = (string) $request->get_param( 'type' );
		$status = (string) $request->get_param( 'status' );
		$types  = in_array( $type, self::TYPES, true ) ? array( $type ) : self::TYPES;
		$counts = self::counts( $types );

		$query = new WP_Query(
			array(
				'post_type'              => $types,
				'post_status'            => in_array( $status, self::STATUSES, true ) ? $status : self::STATUSES,
				's'                      => (string) $request->get_param( 'search' ),
				'posts_per_page'         => (int) $request->get_param( 'per_page' ),
				'paged'                  => (int) $request->get_param( 'page' ),
				'orderby'                => 'date',
				'order'                  => 'DESC',
				'no_found_rows'          => false,
				'ignore_sticky_posts'    => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		$authors = array();
		$items   = array();
		foreach ( $query->posts as $post ) {
			$author_id = (int) $post->post_author;
			if ( ! isset( $authors[ $author_id ] ) ) {
				$user                   = get_userdata( $author_id );
				$authors[ $author_id ] = $user ? html_entity_decode( $user->display_name, ENT_QUOTES, 'UTF-8' ) : '';
			}
			$items[] = array(
				'id'        => (int) $post->ID,
				'title'     => html_entity_decode( get_the_title( $post ), ENT_QUOTES, 'UTF-8' ),
				'type'      => $post->post_type,
				'status'    => $post->post_status,
				'author'    => $authors[ $author_id ],
				'date'      => (int) strtotime( $post->post_date_gmt . ' UTC' ),
				'modified'  => (int) strtotime( $post->post_modified_gmt . ' UTC' ),
				'permalink' => (string) get_permalink( $post ),
			);
		}

		return array(
			'items'  => $items,
			'counts' => $counts,
			'total'  => (int) $query->found_posts,
		);
	}
}
