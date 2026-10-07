/**
 * Host half of `dsh-share-card`.
 *
 * This package contributes browser presentation only: the card studio lives entirely in the
 * client bundle (`exports["./client"]`, declared through `dsh.client` in the manifest), which
 * `@deepseek-ai/dsh-client-modules` scans off this loader row and hands to the page.
 *
 * The host row itself must exist and mount cleanly so that the client scan finds a package
 * manifest; it intentionally does nothing else. No webserver route, no asset route: the whole
 * render path (message extraction, canvas drawing, PNG export) runs in the page.
 */

/** Host plugin body — intentionally empty (browser-only contribution). */
export function apply() {}
