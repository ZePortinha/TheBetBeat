import { describe, expect, it } from "vitest";
import { androidAssetLinks, appleAppSiteAssociation, NATIVE_APP_ID } from "./app-links";

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join(":");

describe("app links", () => {
  it("claims only the guest app paths for iOS", () => {
    const aasa = appleAppSiteAssociation("TEAM123456", NATIVE_APP_ID);
    expect(aasa.applinks.details[0]?.appIDs).toEqual(["TEAM123456.app.discontrol"]);
    expect(aasa.applinks.details[0]?.components).toEqual([{ "/": "/s/*", comment: expect.any(String) }]);
  });

  it("lists valid Android fingerprints and ignores junk", () => {
    const links = androidAssetLinks(NATIVE_APP_ID, `${FP}, nope`);
    expect(links?.[0]?.target.sha256_cert_fingerprints).toEqual([FP.toUpperCase()]);
    expect(androidAssetLinks(NATIVE_APP_ID, "nope")).toBeNull();
  });
});
