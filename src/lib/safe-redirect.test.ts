import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

const BASE = "https://app.school.example/login";
const hostAfterRedirect = (value: string) => new URL(safeNextPath(value), BASE).host;

describe("safeNextPath (post-login redirect target)", () => {
  it("keeps ordinary in-app paths, including query and hash", () => {
    for (const path of ["/", "/operations", "/years/abc/dashboard?tab=1", "/operations/absences/x#top", "/settings?next=//evil.example"]) {
      expect(safeNextPath(path)).toBe(path);
    }
  });

  it("falls back for empty, absolute and protocol-relative values", () => {
    for (const value of [null, undefined, "", "https://evil.example", "//evil.example", "javascript:alert(1)", "evil.example"]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });

  it("refuses values that browsers turn into another host (tab/newline stripping, backslashes)", () => {
    for (const value of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\\evil.example", "/\\/evil.example", "/x/\\..\\\\evil", "/\u0000/evil.example"]) {
      expect(safeNextPath(value)).toBe("/");
      expect(hostAfterRedirect(value)).toBe("app.school.example");
    }
  });

  it("never sends the user back to the sign-in pages or to the API, in any letter case", () => {
    for (const value of ["/login", "/LOGIN?next=/x", "/signup", "/SignUp/", "/api/admin/logout", "/API/admin/me"]) {
      expect(safeNextPath(value)).toBe("/");
    }
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("//evil.example", "/settings")).toBe("/settings");
  });
});
