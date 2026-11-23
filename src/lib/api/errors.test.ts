import { describe, expect, it } from "vitest";
import { GENERIC_SERVER_MESSAGE, networkError, normaliseHttpError, parseRetryAfter } from "./errors";

const norm = (status: number, body: unknown, method = "POST", retryAfter: string | null = null) => normaliseHttpError({ status, body, method, retryAfter });

describe("normaliseHttpError: the four backend dialects (PHASE-0-AUDIT §1.0)", () => {
  it("dialect 1: Zod validation maps errors to field errors", () => {
    const e = norm(400, { success: false, message: "Validation failed", errors: { name: ["Grade name is required"], "grades.0.sections.1.code": ["Section code is required"] } });
    expect(e.status).toBe(400);
    expect(e.code).toBeNull();
    expect(e.fieldError("name")).toBe("Grade name is required");
    expect(e.fieldErrors["grades.0.sections.1.code"]).toEqual(["Section code is required"]);
  });

  it("dialect 2: Ajv `{ message }` without success becomes a form-level error", () => {
    const e = norm(400, { message: 'body/academicYearId must match format "uuid"' });
    expect(e.fieldErrors._form).toEqual(['body/academicYearId must match format "uuid"']);
    expect(e.message).toMatch(/expected format/);
  });

  it("dialect 3: data.code refusals keep code and details", () => {
    const e = norm(409, { success: false, message: "The section already has a lesson in that slot. Swap the two lessons instead", data: { code: "SLOT_OCCUPIED", occupantEntryId: "abc" } });
    expect(e.code).toBe("SLOT_OCCUPIED");
    expect(e.details).toEqual({ occupantEntryId: "abc" });
    expect(e.isConflict).toBe(true);
    expect(e.uncertain).toBe(false);
  });

  it("dialect 4: substitution errors.code[0] and string-array details", () => {
    const e = norm(409, {
      success: false,
      message: "Assigning this teacher would give them 4 consecutive teaching periods (P5–P8).",
      errors: { code: ["FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED"], periods: ["5", "6", "7", "8"] },
    });
    expect(e.code).toBe("FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED");
    expect(e.details.periods).toEqual(["5", "6", "7", "8"]);
    expect(e.fieldErrors).toEqual({});
  });

  it("record deletion: errors.blockedBy is a detail, not a field error", () => {
    const e = norm(409, { success: false, message: "Grade cannot be deleted", errors: { blockedBy: ["2 sections", "1 stream"] } });
    expect(e.details.blockedBy).toEqual(["2 sections", "1 stream"]);
    expect(e.fieldErrors).toEqual({});
  });

  it("generation NOT_READY 400 keeps data.status in details (no code)", () => {
    const e = norm(400, { success: false, message: "The academic year is not ready for timetable generation", data: { status: "NOT_READY", errorCount: 2 } });
    expect(e.code).toBeNull();
    expect(e.details.status).toBe("NOT_READY");
  });

  it("generation 409 existingRunId without code", () => {
    const e = norm(409, { success: false, message: "A timetable generation is already queued or running for this academic year", data: { existingRunId: "run-1" } });
    expect(e.code).toBeNull();
    expect(e.details.existingRunId).toBe("run-1");
  });

  it("503 BUSY with envelope is a certain refusal with Retry-After", () => {
    const e = norm(503, { success: false, message: "The timetable is being changed by another request.", data: { code: "BUSY" } }, "POST", "2");
    expect(e.code).toBe("BUSY");
    expect(e.retryAfterMs).toBe(2000);
    expect(e.uncertain).toBe(false);
    expect(e.message).toMatch(/being changed/);
  });

  it("500 never exposes the body (the auth-middleware leak) and marks writes uncertain", () => {
    const e = norm(500, { statusCode: 500, code: "P1001", error: "Internal Server Error", message: "Invalid `this.db.adminSession.findUnique()` invocation in /src/modules/admin/admin.service.ts:132:48" });
    expect(e.message).toBe(GENERIC_SERVER_MESSAGE);
    expect(e.message).not.toMatch(/admin\.service|findUnique/);
    expect(e.uncertain).toBe(true);
    expect(norm(500, null, "GET").uncertain).toBe(false);
  });

  it("429 gets a friendly message", () => {
    expect(norm(429, { success: false, message: "Too many requests. Please try again later." }).message).toMatch(/Too many attempts/);
  });

  it("Prisma P2002 409 without code", () => {
    const e = norm(409, { success: false, message: "code already exists" });
    expect(e.code).toBeNull();
    expect(e.message).toBe("code already exists");
  });

  it("403 and 404 both count as not found", () => {
    expect(norm(403, { success: false, message: "You do not have access to this grade" }, "GET").isNotFound).toBe(true);
    expect(norm(404, { success: false, message: "Grade not found" }, "GET").isNotFound).toBe(true);
  });

  it("network errors: writes are uncertain, reads are not", () => {
    expect(networkError("POST", false).uncertain).toBe(true);
    expect(networkError("GET", true).uncertain).toBe(false);
    expect(networkError("GET", true).code).toBe("TIMEOUT");
  });

  it("parses Retry-After seconds and caps it", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("9999")).toBe(120_000);
    expect(parseRetryAfter(null)).toBeNull();
  });
});
