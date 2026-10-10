<?php
/**
 * Database cleanup (0.35.0): how big the site's tables are, how much of it
 * is leftovers (post revisions, old auto-drafts, trashed posts, spam and
 * trashed comments, expired transients), and a way to delete those and
 * optimize the tables that have free space.
 *
 * Posts and comments are deleted through WordPress (wp_delete_post,
 * wp_delete_comment), so their meta, terms and caches go with them and other
 * plugins hear about it. A cleanup stops after a time budget and reports what
 * is left, so a site with a huge backlog is cleaned over a few runs instead of
 * timing out.
 *
 * @package KontrolWP_Connect
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class KontrolWP_Connect_Database {

	/** What can be cleaned, in the order the dashboard lists them. */
	const ITEMS = array( 'revisions', 'auto_drafts', 'trash_posts', 'spam_comments', 'trash_comments', 'expired_transients' );

	/** Auto-drafts younger than this may belong to an editor that is open right now, so they are left alone. */
	const AUTO_DRAFT_AGE = DAY_IN_SECONDS;

	/** Seconds a cleanup spends deleting before it stops and reports what is left. */
	const TIME_BUDGET = 20;

	/** Rows read per batch while deleting. */
	const BATCH = 200;

	/** How many of the largest tables the report lists. */
	const MAX_TABLES = 10;

	public static function register_routes( $auth ) {
		$ns = KontrolWP_Connect_Rest::NAMESPACE_V1;
		foreach ( array(
			'/database'       => 'report_route',
			'/database/clean' => 'clean_route',
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

	/** The known item keys from untrusted input, each once, in the usual order. */
	public static function clean_items( $input ) {
		if ( ! is_array( $input ) ) {
			return array();
		}
		return array_values( array_intersect( self::ITEMS, $input ) );
	}

	/**
	 * Totals and the largest tables from SHOW TABLE STATUS rows. Data_free is
	 * what OPTIMIZE TABLE can give back.
	 */
	public static function summarize_tables( $rows ) {
		$tables = array();
		$size   = 0;
		$free   = 0;
		foreach ( (array) $rows as $row ) {
			if ( ! is_array( $row ) || empty( $row['Name'] ) ) {
				continue;
			}
			$bytes    = (int) ( $row['Data_length'] ?? 0 ) + (int) ( $row['Index_length'] ?? 0 );
			$overhead = (int) ( $row['Data_free'] ?? 0 );
			$size    += $bytes;
			$free    += $overhead;
			$tables[] = array(
				'name'     => (string) $row['Name'],
				'rows'     => (int) ( $row['Rows'] ?? 0 ),
				'bytes'    => $bytes,
				'overhead' => $overhead,
				'engine'   => (string) ( $row['Engine'] ?? '' ),
			);
		}
		usort(
			$tables,
			function ( $a, $b ) {
				return $b['bytes'] <=> $a['bytes'] ?: strcmp( $a['name'], $b['name'] );
			}
		);
		return array(
			'size'     => $size,
			'overhead' => $free,
			'count'    => count( $tables ),
			'largest'  => array_slice( $tables, 0, self::MAX_TABLES ),
		);
	}

	/* ---- WordPress ---- */

	/** The site's own tables (those starting with its table prefix), as SHOW TABLE STATUS rows. */
	private static function table_rows() {
		global $wpdb;
		return $wpdb->get_results( $wpdb->prepare( 'SHOW TABLE STATUS LIKE %s', $wpdb->esc_like( $wpdb->base_prefix ) . '%' ), ARRAY_A ); // phpcs:ignore WordPress.DB
	}

	/** The WHERE clause for one post item, or null for an item that is not about posts. */
	private static function post_where( $item ) {
		global $wpdb;
		switch ( $item ) {
			case 'revisions':
				return "post_type = 'revision'";
			case 'auto_drafts':
				// A new auto-draft has no GMT dates, so its local post_date is compared, as wp_delete_auto_drafts does.
				return $wpdb->prepare( "post_status = 'auto-draft' AND post_date < %s", wp_date( 'Y-m-d H:i:s', time() - self::AUTO_DRAFT_AGE ) );
			case 'trash_posts':
				return "post_status = 'trash'";
		}
		return null;
	}

	/** The comment_approved value for one comment item, or null. */
	private static function comment_status( $item ) {
		return array(
			'spam_comments'  => 'spam',
			'trash_comments' => 'trash',
		)[ $item ] ?? null;
	}

	/** How many there are of one item and roughly how many bytes they hold. */
	private static function measure( $item ) {
		global $wpdb;
		$where = self::post_where( $item );
		if ( null !== $where ) {
			$row = $wpdb->get_row( "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(post_content) + LENGTH(post_title) + LENGTH(post_excerpt)), 0) AS bytes FROM {$wpdb->posts} WHERE {$where}", ARRAY_A ); // phpcs:ignore WordPress.DB
		} elseif ( null !== self::comment_status( $item ) ) {
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(comment_content)), 0) AS bytes FROM {$wpdb->comments} WHERE comment_approved = %s", self::comment_status( $item ) ), ARRAY_A ); // phpcs:ignore WordPress.DB
		} else {
			// A transient is two options: the value and its timeout. Count the expired timeouts, measure both.
			$row = $wpdb->get_row(
				$wpdb->prepare(
					"SELECT COUNT(t.option_id) AS n, COALESCE(SUM(LENGTH(t.option_value) + COALESCE(LENGTH(v.option_value), 0)), 0) AS bytes
					FROM {$wpdb->options} t
					LEFT JOIN {$wpdb->options} v ON v.option_name = REPLACE(t.option_name, 'transient_timeout_', 'transient_')
					WHERE (t.option_name LIKE %s OR t.option_name LIKE %s) AND t.option_value < %d",
					$wpdb->esc_like( '_transient_timeout_' ) . '%',
					$wpdb->esc_like( '_site_transient_timeout_' ) . '%',
					time()
				),
				ARRAY_A
			); // phpcs:ignore WordPress.DB
		}
		return array(
			'count' => (int) ( $row['n'] ?? 0 ),
			'bytes' => (int) ( $row['bytes'] ?? 0 ),
		);
	}

	public static function report() {
		$items = array();
		foreach ( self::ITEMS as $item ) {
			$items[ $item ] = self::measure( $item );
		}
		return array(
			'tables' => self::summarize_tables( self::table_rows() ),
			'items'  => $items,
		);
	}

	public static function report_route() {
		return self::report();
	}

	/** Deletes one item until none are left or the deadline passes. Returns how many were deleted. */
	private static function delete_item( $item, $deadline ) {
		global $wpdb;
		$deleted = 0;
		if ( 'expired_transients' === $item ) {
			$before = self::measure( $item )['count'];
			delete_expired_transients( true );
			return max( 0, $before - self::measure( $item )['count'] );
		}
		$where  = self::post_where( $item );
		$status = self::comment_status( $item );
		while ( microtime( true ) < $deadline ) {
			$ids = null !== $where
				? $wpdb->get_col( "SELECT ID FROM {$wpdb->posts} WHERE {$where} ORDER BY ID LIMIT " . (int) self::BATCH ) // phpcs:ignore WordPress.DB
				: $wpdb->get_col( $wpdb->prepare( "SELECT comment_ID FROM {$wpdb->comments} WHERE comment_approved = %s ORDER BY comment_ID LIMIT %d", $status, self::BATCH ) ); // phpcs:ignore WordPress.DB
			if ( ! $ids ) {
				break;
			}
			$progress = 0;
			foreach ( $ids as $id ) {
				if ( microtime( true ) >= $deadline ) {
					break;
				}
				$done = null !== $where ? wp_delete_post( (int) $id, true ) : wp_delete_comment( (int) $id, true );
				if ( $done ) {
					++$deleted;
					++$progress;
				}
			}
			// Something keeps refusing to be deleted (a plugin hook), so stop instead of looping on it.
			if ( 0 === $progress ) {
				break;
			}
		}
		return $deleted;
	}

	public static function clean_route( $request ) {
		$body     = $request->get_json_params();
		$body     = is_array( $body ) ? $body : array();
		$items    = self::clean_items( $body['items'] ?? array() );
		$optimize = ! empty( $body['optimize'] );
		if ( ! $items && ! $optimize ) {
			return new WP_Error( 'kontrolwp_invalid_cleanup', 'Choose something to clean up.', array( 'status' => 400 ) );
		}
		if ( function_exists( 'set_time_limit' ) ) {
			@set_time_limit( 120 ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		}
		$deadline = microtime( true ) + self::TIME_BUDGET;
		$deleted  = array();
		foreach ( $items as $item ) {
			$deleted[ $item ] = self::delete_item( $item, $deadline );
		}
		$optimized = 0;
		if ( $optimize ) {
			global $wpdb;
			foreach ( self::table_rows() as $row ) {
				if ( (int) ( $row['Data_free'] ?? 0 ) <= 0 || empty( $row['Name'] ) ) {
					continue;
				}
				$wpdb->query( 'OPTIMIZE TABLE `' . str_replace( '`', '``', $row['Name'] ) . '`' ); // phpcs:ignore WordPress.DB
				++$optimized;
			}
		}
		$report = self::report();
		$left   = 0;
		foreach ( $items as $item ) {
			$left += $report['items'][ $item ]['count'];
		}
		return array(
			'deleted'    => $deleted,
			'optimized'  => $optimized,
			// Some were left because the time ran out; another run picks them up.
			'unfinished' => $left > 0,
			'report'     => $report,
		);
	}
}
