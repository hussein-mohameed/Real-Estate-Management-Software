import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_SECONDS,
  issueSession,
  secretsMatch,
  shouldRenew,
  verifySession,
} from "./jwt";

const SECRET = "a".repeat(48);
const OTHER = "b".repeat(48);
const NOW = 1_800_000_000;

describe("جلسة OTP — الإصدار والتحقّق", () => {
  it("رمز صالح يُقبل ويعيد معرّف المستخدم", () => {
    const token = issueSession("user_1", SECRET, NOW);
    const r = verifySession(token, SECRET, NOW + 10);
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.claims.sub).toBe("user_1");
      expect(r.claims.exp - r.claims.iat).toBe(SESSION_TTL_SECONDS);
    }
  });

  it("كل جلسة لها jti مستقل — يسمح بإبطال جلسة بعينها", () => {
    const a = issueSession("user_1", SECRET, NOW);
    const b = issueSession("user_1", SECRET, NOW);
    expect(a).not.toBe(b);
  });

  it("**سرّ مختلف يُرفض**", () => {
    const token = issueSession("user_1", SECRET, NOW);
    expect(verifySession(token, OTHER, NOW + 10)).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("**العبث بالحمولة يُرفض** — لا يمكن انتحال مستخدم آخر", () => {
    const token = issueSession("user_1", SECRET, NOW);
    const [h, , s] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "user_admin", iat: NOW, exp: NOW + 9999, jti: "x" }),
    ).toString("base64url");
    expect(verifySession(`${h}.${forged}.${s}`, SECRET, NOW + 10).valid).toBe(false);
  });

  it("🔴 **هجوم alg:none مرفوض** — الخوارزمية تُفحص صراحةً لا تُقبل من الترويسة", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ sub: "user_admin", iat: NOW, exp: NOW + 9999, jti: "x" }),
    ).toString("base64url");
    expect(verifySession(`${header}.${body}.`, SECRET, NOW + 10)).toEqual({
      valid: false,
      reason: "bad-algorithm",
    });
  });

  it("الرمز المنتهي يُرفض", () => {
    const token = issueSession("user_1", SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + SESSION_TTL_SECONDS + 1)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("رمز مشوَّه يُرفض بلا رمي استثناء", () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "...", "x.y.z"]) {
      expect(verifySession(bad, SECRET, NOW).valid).toBe(false);
    }
  });

  it("يرفض سرّاً قصيراً عند الإصدار — لا جلسة بحماية ضعيفة", () => {
    expect(() => issueSession("user_1", "short", NOW)).toThrow(/AUTH_SECRET/u);
  });

  it("التجديد في آخر ثلث العمر لا قبله", () => {
    const token = issueSession("user_1", SECRET, NOW);
    const r = verifySession(token, SECRET, NOW);
    if (!r.valid) throw new Error("unreachable");
    expect(shouldRenew(r.claims, NOW + 60)).toBe(false);
    expect(shouldRenew(r.claims, NOW + SESSION_TTL_SECONDS - 100)).toBe(true);
  });
});

describe("secretsMatch — لـCRON_SECRET وسرّ الـwebhook", () => {
  it("يطابق المتطابق ويرفض المختلف", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
    expect(secretsMatch("s3cret", "s3crex")).toBe(false);
  });

  it("يرفض الفارغ والمعدوم بلا رمي", () => {
    expect(secretsMatch(null, "x")).toBe(false);
    expect(secretsMatch(undefined, "x")).toBe(false);
    expect(secretsMatch("", "x")).toBe(false);
  });

  it("يرفض المختلف طولاً بلا أن يفشل", () => {
    expect(secretsMatch("short", "muchlongersecret")).toBe(false);
  });
});
