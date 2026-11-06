/**
 * Party URLs that more than one screen needs to build or recognise.
 * Tokens are signed and URL-safe (base64url), so they go in as they are.
 */

/** The winner's moment, its own screen (2026-11-06): no tab bar, no scroll. */
export function winPath(token: string, slotId: string): string {
  return `/s/${token}/win/${slotId}`;
}

export function isWinPath(pathname: string): boolean {
  return winSlotFrom(pathname) !== null;
}

/** The auction on a winner's page address, or null on any other page. */
export function winSlotFrom(pathname: string): string | null {
  return /\/s\/[^/]+\/win\/([^/]+)$/.exec(pathname)?.[1] ?? null;
}

/** The ranking; `me` scrolls to the guest's own place once it has been shown. */
export function rankingPath(token: string, opts: { me?: boolean } = {}): string {
  return `/s/${token}/top${opts.me ? "?me=1" : ""}`;
}
