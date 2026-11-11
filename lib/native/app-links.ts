/**
 * Files the stores' apps check on the site so a camera-scanned QR
 * (https://<site>/s/<token>) opens the installed app instead of the browser:
 * Apple universal links and Android App Links. Only guest links (/s/*) are
 * claimed; staff surfaces always stay in the browser.
 */

/** Android package / iOS bundle id (capacitor.config.ts appId). */
export const NATIVE_APP_ID = "app.discontrol";

export function appleAppSiteAssociation(teamId: string, bundleId: string) {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: [{ "/": "/s/*", comment: "Guest app of an event (QR)" }],
        },
      ],
    },
  };
}

/** `fingerprints` is the comma-separated ANDROID_CERT_SHA256 value (AA:BB:… form). */
export function androidAssetLinks(packageName: string, fingerprints: string) {
  const list = fingerprints
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  if (list.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: list },
    },
  ];
}
