<?php
// Runs the pure parts of KontrolWP_Connect_SEO_Content outside WordPress.
// Input (JSON on stdin): { "fn": "clean|is_external|merge_rel|alt_from_title|feed_footer|breadcrumb_schema|breadcrumb_html|site_graph|article_node", "args": [...] }; prints JSON, or the HTML as a string.

define( 'ABSPATH', __DIR__ . '/' );
function wp_strip_all_tags( $text ) { return trim( strip_tags( $text ) ); }
class KontrolWP_Connect_Rest { const NAMESPACE_V1 = 'kontrolwp/v1'; }
require __DIR__ . '/../../plugin/kontrolwp-connect/includes/class-kontrolwp-connect-seo-content.php';

$input = json_decode( stream_get_contents( STDIN ), true );
echo json_encode( call_user_func_array( array( 'KontrolWP_Connect_SEO_Content', $input['fn'] ), $input['args'] ) );
