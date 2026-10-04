<?php
// Runs the pure parts of KontrolWP_Connect_SEO_Archives outside WordPress.
// Input (JSON on stdin): { "fn": "strip_category_base|strip_category_base_path|eligible_categories|category_rules", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-seo-archives.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_SEO_Archives', $input['fn'] ), $input['args'] ) );
