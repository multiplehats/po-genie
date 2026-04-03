=== Test Plugin ===
Contributors: testauthor
Tags: testing, example, demo
Requires at least: 6.0
Tested up to: 6.9
Requires PHP: 8.1
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

AI-powered website translation for WordPress.

== Description ==

This plugin translates your entire WordPress site into multiple languages using AI-powered translation. Simply install the plugin, connect your API key, and your site is available in every language you configure.

= How It Works =

The plugin captures your page HTML and sends it to the cloud translation API. The API returns translated content which is served to visitors based on their selected language.

= Features =

* Automatically translates all your pages and posts.
* Generates hreflang tags and creates language-specific URLs.
* Built-in language switcher available as a block, widget, or shortcode.
* Translations are cached for fast repeat visits.
* Works with WooCommerce, Yoast SEO, and other popular plugins.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/`.
2. Activate the plugin through the Plugins menu.
3. Go to Settings and enter your API key.
4. Select your target languages.

== Frequently Asked Questions ==

= Do I need an account? =

Yes. You need an API key from the service dashboard to use this plugin.

= Does this affect my site's performance? =

Translations are cached using WordPress transients. The first visit may take slightly longer, but subsequent visits are served instantly.

= What happens if the API is unavailable? =

If the API is unreachable, the plugin serves the original untranslated page. Your site remains fully functional.

== Screenshots ==

1. Settings page — connect your API key and configure languages.
2. Language switcher dropdown on the frontend.
3. A translated page served in French.

== Changelog ==

= 1.1.0 =
* Added support for WooCommerce product pages.
* Improved caching performance by 40%.

= 1.0.0 =
* Initial release.
* AI-powered page translation.
* Language switcher with multiple display options.

== Upgrade Notice ==

= 1.1.0 =
Adds WooCommerce support and faster caching.

= 1.0.0 =
Initial release.
