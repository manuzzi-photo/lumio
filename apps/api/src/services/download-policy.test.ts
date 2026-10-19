import { describe, it, expect } from "vitest";

import {
  downloadVariantRefusal,
  parseDownloadVariant,
  resolveDownloadFlags,
} from "./download-policy.js";

/** Which download versions a gallery offers (#70). Every customer download
 *  path goes through these, so the combinations are pinned down here. */

const BOTH = { downloadOriginalsEnabled: true, downloadWebEnabled: true };
const ORIGINALS_ONLY = { downloadOriginalsEnabled: true, downloadWebEnabled: false };
const WEB_ONLY = { downloadOriginalsEnabled: false, downloadWebEnabled: true };

describe("parseDownloadVariant", () => {
  it("web only on ?variant=web, everything else is the original (old clients)", () => {
    expect(parseDownloadVariant("web")).toBe("web");
    expect(parseDownloadVariant("original")).toBe("original");
    expect(parseDownloadVariant(undefined)).toBe("original");
    expect(parseDownloadVariant("print")).toBe("original");
  });
});

describe("downloadVariantRefusal", () => {
  it("both offered: nothing refused", () => {
    expect(downloadVariantRefusal(BOTH, "original")).toBeNull();
    expect(downloadVariantRefusal(BOTH, "web")).toBeNull();
  });
  it("originals only (#70): web refused", () => {
    expect(downloadVariantRefusal(ORIGINALS_ONLY, "original")).toBeNull();
    expect(downloadVariantRefusal(ORIGINALS_ONLY, "web")).toBe("web_disabled");
  });
  it("web only: originals refused, as before", () => {
    expect(downloadVariantRefusal(WEB_ONLY, "web")).toBeNull();
    expect(downloadVariantRefusal(WEB_ONLY, "original")).toBe("originals_disabled");
  });
});

describe("resolveDownloadFlags", () => {
  const current = { downloadEnabled: true, ...BOTH };

  it("keeps untouched values", () => {
    expect(resolveDownloadFlags(current, {})).toEqual({ ok: true, flags: current });
  });
  it("allows switching the web version off", () => {
    const r = resolveDownloadFlags(current, { downloadWebEnabled: false });
    expect(r).toEqual({ ok: true, flags: { downloadEnabled: true, ...ORIGINALS_ONLY } });
  });
  it("refuses downloads on with neither version", () => {
    expect(resolveDownloadFlags({ downloadEnabled: true, ...ORIGINALS_ONLY }, { downloadOriginalsEnabled: false }).ok).toBe(false);
    expect(resolveDownloadFlags(current, { downloadOriginalsEnabled: false, downloadWebEnabled: false }).ok).toBe(false);
  });
  it("allows both off when downloads are off altogether", () => {
    expect(
      resolveDownloadFlags(current, {
        downloadEnabled: false,
        downloadOriginalsEnabled: false,
        downloadWebEnabled: false,
      }).ok
    ).toBe(true);
  });
  it("refuses switching downloads back on while both versions are off", () => {
    const off = { downloadEnabled: false, downloadOriginalsEnabled: false, downloadWebEnabled: false };
    expect(resolveDownloadFlags(off, { downloadEnabled: true }).ok).toBe(false);
  });
});
