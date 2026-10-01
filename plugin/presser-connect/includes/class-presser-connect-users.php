<?php
/**
 * User management for the dashboard: list this site's users and roles, add
 * a user, change a user's role, send a password reset, or delete a user.
 * Everything goes through WordPress's own functions, as the Users screen
 * does. The last administrator can never be removed or demoted, and a
 * deleted user's content goes to another administrator.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Presser_Connect_Users {

	/** Most users one list returns; the dashboard keeps up to this many. */
	const MAX_USERS = 2000;

	public static function register_routes( $auth ) {
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/users',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'index' ),
				'permission_callback' => $auth,
			)
		);
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/users/create',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'create' ),
				'permission_callback' => $auth,
				'args'                => array(
					'login'  => array(
						'required' => true,
						'type'     => 'string',
					),
					'email'  => array(
						'required' => true,
						'type'     => 'string',
					),
					'role'   => array(
						'required' => true,
						'type'     => 'string',
					),
					'first_name' => array( 'type' => 'string' ),
					'last_name'  => array( 'type' => 'string' ),
					// Empty: WordPress makes one and the user sets their own from the email.
					'password'   => array( 'type' => 'string' ),
					'notify'     => array(
						'type'    => 'boolean',
						'default' => true,
					),
				),
			)
		);
		register_rest_route(
			Presser_Connect_Rest::NAMESPACE_V1,
			'/users/manage',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'manage' ),
				'permission_callback' => $auth,
				'args'                => array(
					'user_id' => array(
						'required' => true,
						'type'     => 'integer',
					),
					'action'  => array(
						'required' => true,
						'type'     => 'string',
						'enum'     => array( 'set-role', 'reset-password', 'delete' ),
					),
					'role'    => array( 'type' => 'string' ),
				),
			)
		);
	}

	public static function index() {
		$roles = array();
		foreach ( wp_roles()->get_names() as $slug => $name ) {
			$roles[] = array(
				'slug' => $slug,
				'name' => translate_user_role( $name ),
			);
		}
		$users = get_users(
			array(
				'number'  => self::MAX_USERS,
				'orderby' => 'ID',
				'order'   => 'ASC',
			)
		);
		$items = array();
		foreach ( $users as $user ) {
			$items[] = array(
				'id'           => (int) $user->ID,
				'login'        => $user->user_login,
				'email'        => $user->user_email,
				'display_name' => html_entity_decode( $user->display_name, ENT_QUOTES, 'UTF-8' ),
				'roles'        => array_values( (array) $user->roles ),
				'registered'   => (int) strtotime( $user->user_registered . ' UTC' ),
			);
		}
		return array(
			'users' => $items,
			'roles' => $roles,
			'total' => (int) count_users()['total_users'],
		);
	}

	/**
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function create( $request ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
		$login = sanitize_user( (string) $request['login'], true );
		$email = sanitize_email( (string) $request['email'] );
		$role  = (string) $request['role'];

		if ( '' === $login ) {
			return self::bad_request( __( 'Enter a username.', 'presser-connect' ) );
		}
		if ( ! is_email( $email ) ) {
			return self::bad_request( __( 'Enter a valid email address.', 'presser-connect' ) );
		}
		if ( ! wp_roles()->is_role( $role ) ) {
			return self::bad_request( __( 'That role does not exist on this site.', 'presser-connect' ) );
		}
		if ( username_exists( $login ) ) {
			return new WP_Error( 'presser_user_exists', __( 'A user with that username already exists.', 'presser-connect' ), array( 'status' => 409 ) );
		}
		if ( email_exists( $email ) ) {
			return new WP_Error( 'presser_user_exists', __( 'A user with that email address already exists.', 'presser-connect' ), array( 'status' => 409 ) );
		}

		$password = (string) $request['password'];
		$user_id  = wp_insert_user(
			array(
				'user_login' => $login,
				'user_email' => $email,
				'user_pass'  => '' === $password ? wp_generate_password( 24, true, true ) : $password,
				'first_name' => sanitize_text_field( (string) $request['first_name'] ),
				'last_name'  => sanitize_text_field( (string) $request['last_name'] ),
				'role'       => $role,
			)
		);
		if ( is_wp_error( $user_id ) ) {
			return new WP_Error( 'presser_user_failed', $user_id->get_error_message(), array( 'status' => 400 ) );
		}
		if ( is_multisite() ) {
			add_user_to_blog( get_current_blog_id(), $user_id, $role );
		}
		if ( $request['notify'] ) {
			// The same email the Add New User screen sends, with a link to set a password.
			wp_new_user_notification( $user_id, null, 'user' );
		}
		return array(
			'ok'      => true,
			'user_id' => (int) $user_id,
		);
	}

	/**
	 * @param WP_REST_Request $request Incoming request.
	 */
	public static function manage( $request ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
		$user = get_userdata( (int) $request['user_id'] );
		if ( ! $user || ( is_multisite() && ! is_user_member_of_blog( $user->ID ) ) ) {
			return new WP_Error( 'presser_not_found', __( 'That user does not exist on this site.', 'presser-connect' ), array( 'status' => 404 ) );
		}

		switch ( $request['action'] ) {
			case 'set-role':
				$role = (string) $request['role'];
				if ( ! wp_roles()->is_role( $role ) ) {
					return self::bad_request( __( 'That role does not exist on this site.', 'presser-connect' ) );
				}
				if ( 'administrator' !== $role && self::is_last_admin( $user ) ) {
					return self::last_admin();
				}
				$user->set_role( $role );
				return array( 'ok' => true );

			case 'reset-password':
				$result = retrieve_password( $user->user_login );
				if ( is_wp_error( $result ) ) {
					return new WP_Error( 'presser_user_failed', wp_strip_all_tags( $result->get_error_message() ), array( 'status' => 500 ) );
				}
				return array( 'ok' => true );

			default:
				if ( self::is_last_admin( $user ) ) {
					return self::last_admin();
				}
				$reassign = self::reassign_to( $user->ID );
				if ( ! $reassign ) {
					return new WP_Error( 'presser_user_failed', __( 'There is no other administrator to give this user\'s content to.', 'presser-connect' ), array( 'status' => 409 ) );
				}
				$deleted = is_multisite()
					? remove_user_from_blog( $user->ID, get_current_blog_id(), $reassign )
					: wp_delete_user( $user->ID, $reassign );
				if ( ! $deleted || is_wp_error( $deleted ) ) {
					return new WP_Error( 'presser_user_failed', __( 'WordPress could not delete that user.', 'presser-connect' ), array( 'status' => 500 ) );
				}
				return array( 'ok' => true );
		}
	}

	/** True when the user is this site's only administrator. */
	private static function is_last_admin( $user ) {
		if ( ! in_array( 'administrator', (array) $user->roles, true ) ) {
			return false;
		}
		$admins = get_users(
			array(
				'role'   => 'administrator',
				'fields' => 'ID',
				'number' => 2,
			)
		);
		return count( $admins ) < 2;
	}

	/** The administrator who receives a deleted user's content: the earliest one other than them. */
	private static function reassign_to( $user_id ) {
		$admins = get_users(
			array(
				'role'    => 'administrator',
				'fields'  => 'ID',
				'orderby' => 'ID',
				'order'   => 'ASC',
				'exclude' => array( $user_id ),
				'number'  => 1,
			)
		);
		return $admins ? (int) $admins[0] : 0;
	}

	private static function last_admin() {
		return new WP_Error( 'presser_last_admin', __( 'This is the site\'s only administrator, so it cannot be removed or given another role.', 'presser-connect' ), array( 'status' => 409 ) );
	}

	private static function bad_request( $message ) {
		return new WP_Error( 'presser_bad_request', $message, array( 'status' => 400 ) );
	}
}
