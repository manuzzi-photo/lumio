import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  createPageVisitorToken,
  createVisitorToken,
  pageVisitorCookieName,
  passwordFingerprint,
  verifyPageVisitorToken,
  verifyVisitorToken,
  visitorCookieName,
} from "./visitor.js";

describe("visitor token", () => {
  it("round-trips a valid token", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: "22222222-2222-2222-2222-222222222222",
      pw: true,
    });
    const claims = verifyVisitorToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.gid).toBe("11111111-1111-1111-1111-111111111111");
    expect(claims?.aid).toBe("22222222-2222-2222-2222-222222222222");
    expect(claims?.pw).toBe(true);
    expect(claims?.exp).toBeGreaterThan(Date.now());
  });

  it("supports null accessId (anonymous visitor)", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: null,
      pw: false,
    });
    const claims = verifyVisitorToken(token);
    expect(claims?.aid).toBeNull();
    expect(claims?.pw).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: null,
      pw: false,
    });
    // Mit dem Signaturteil hantieren
    const [payload, sig] = token.split(".");
    const tampered = `${payload}A.${sig}`;
    expect(verifyVisitorToken(tampered)).toBeNull();
  });

  it("rejects a token with bad signature", () => {
    const token = createVisitorToken({
      gid: "11111111-1111-1111-1111-111111111111",
      aid: null,
      pw: false,
    });
    const [payload] = token.split(".");
    expect(verifyVisitorToken(`${payload}.AAAA`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyVisitorToken("")).toBeNull();
    expect(verifyVisitorToken("not-a-token")).toBeNull();
    expect(verifyVisitorToken("a.b.c")).toBeNull();
  });

  it("derives a cookie name from gallery id", () => {
    const name = visitorCookieName("11111111-1111-1111-1111-111111111111");
    expect(name).toMatch(/^lumio_v_/);
    expect(name).not.toMatch(/-/); // dashes raus
  });
});

describe("password fingerprint", () => {
  it("is stable for a hash and changes when the hash changes", () => {
    expect(passwordFingerprint("hash-a")).toBe(passwordFingerprint("hash-a"));
    expect(passwordFingerprint("hash-a")).not.toBe(passwordFingerprint("hash-b"));
    expect(passwordFingerprint("hash-a")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("landing page visitor token", () => {
  const PID = "44444444-4444-4444-4444-444444444444";

  it("round-trips a valid token", () => {
    const token = createPageVisitorToken({ pid: PID, pwfp: "abc123" });
    const claims = verifyPageVisitorToken(token);
    expect(claims?.pid).toBe(PID);
    expect(claims?.pwfp).toBe("abc123");
    expect(claims?.k).toBe("page");
    expect(claims?.exp).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered payload and a bad signature", () => {
    const token = createPageVisitorToken({ pid: PID, pwfp: "abc123" });
    const [payload, sig] = token.split(".");
    expect(verifyPageVisitorToken(`${payload}A.${sig}`)).toBeNull();
    expect(verifyPageVisitorToken(`${payload}.AAAA`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyPageVisitorToken("")).toBeNull();
    expect(verifyPageVisitorToken("not-a-token")).toBeNull();
    expect(verifyPageVisitorToken("a.b.c")).toBeNull();
  });

  it("is not accepted as a gallery token", () => {
    // Unlocking a page must never unlock a gallery on it.
    const token = createPageVisitorToken({ pid: PID, pwfp: "abc123" });
    expect(verifyVisitorToken(token)).toBeNull();
  });

  it("a gallery token is not accepted as a page token", () => {
    const token = createVisitorToken({ gid: PID, aid: null, pw: true });
    expect(verifyPageVisitorToken(token)).toBeNull();
  });

  it("rejects a page token that has been signed but is expired", async () => {
    // Forge nothing: sign a payload with the server secret, exactly as
    // createPageVisitorToken() does, but with an exp in the past.
    const payload = Buffer.from(
      JSON.stringify({ k: "page", pid: PID, pwfp: "abc123", exp: Date.now() - 1000 })
    ).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET as string)
      .update(payload)
      .digest("base64url");
    expect(verifyPageVisitorToken(`${payload}.${sig}`)).toBeNull();
  });

  it("rejects a signed token that lacks the page marker or its claims", () => {
    const sign = (obj: unknown) => {
      const payload = Buffer.from(JSON.stringify(obj)).toString("base64url");
      const sig = createHmac("sha256", process.env.SESSION_SECRET as string)
        .update(payload)
        .digest("base64url");
      return `${payload}.${sig}`;
    };
    const exp = Date.now() + 60_000;
    expect(verifyPageVisitorToken(sign({ pid: PID, pwfp: "x", exp }))).toBeNull();
    expect(verifyPageVisitorToken(sign({ k: "page", pwfp: "x", exp }))).toBeNull();
    expect(verifyPageVisitorToken(sign({ k: "page", pid: PID, exp }))).toBeNull();
    expect(verifyPageVisitorToken(sign(42))).toBeNull();
  });

  it("derives a cookie name distinct from the gallery cookie", () => {
    const page = pageVisitorCookieName(PID);
    expect(page).toMatch(/^lumio_p_/);
    expect(page).not.toMatch(/-/);
    expect(page).not.toBe(visitorCookieName(PID));
  });
});
