<?php
// Runs the pure parts of KontrolWP_Connect_SEO_Score outside WordPress.
// Input (JSON on stdin): { "fn": "analyze|clean_keyword|count_links|count_images|sentence_lengths|plain_text", "args": [...] }; prints JSON.

define( 'ABSPATH', __DIR__ . '/' );
function wp_strip_all_tags( $text ) { return trim( strip_tags( $text ) ); }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-seo-score.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_SEO_Score', $input['fn'] ), $input['args'] ) );
