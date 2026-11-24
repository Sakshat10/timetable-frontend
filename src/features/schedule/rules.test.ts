import { describe, expect, it } from "vitest";
import { clampBreak, dayPreview, schedulePatch, validateSchedule, valuesFromConfig, weeklyCapacity } from "./rules";

const config = { workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const, periodsPerDay: 8, breakAfterPeriod: 4 };
const cfg = { ...config, workingDays: [...config.workingDays] };

describe("validateSchedule", () => {
  it("accepts a valid week", () => {
    expect(validateSchedule({ workingDays: ["MONDAY"], periodsPerDay: 2, breakAfterPeriod: 1 })).toEqual({});
  });
  it("needs a day, 2-12 periods, and a break between two periods", () => {
    expect(validateSchedule({ workingDays: [], periodsPerDay: 8, breakAfterPeriod: 4 }).workingDays).toBeDefined();
    expect(validateSchedule({ workingDays: ["MONDAY"], periodsPerDay: 13, breakAfterPeriod: 4 }).periodsPerDay).toBeDefined();
    expect(validateSchedule({ workingDays: ["MONDAY"], periodsPerDay: 1, breakAfterPeriod: 1 }).periodsPerDay).toBeDefined();
    expect(validateSchedule({ workingDays: ["MONDAY"], periodsPerDay: undefined, breakAfterPeriod: 1 }).periodsPerDay).toBeDefined();
    expect(validateSchedule({ workingDays: ["MONDAY"], periodsPerDay: 6, breakAfterPeriod: 6 }).breakAfterPeriod).toBe("Choose a period from 1 to 5");
  });
});

describe("schedulePatch", () => {
  it("is empty when nothing changed (day order ignored)", () => {
    expect(schedulePatch(cfg, { workingDays: ["FRIDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY"], periodsPerDay: 8, breakAfterPeriod: 4 })).toEqual({});
  });
  it("sends only changed fields, days in week order", () => {
    expect(schedulePatch(cfg, { workingDays: ["SATURDAY", ...cfg.workingDays], periodsPerDay: 8, breakAfterPeriod: 4 })).toEqual({
      workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
    });
    expect(schedulePatch(cfg, { workingDays: cfg.workingDays, periodsPerDay: 9, breakAfterPeriod: 4 })).toEqual({ periodsPerDay: 9 });
  });
  it("sends the break with the periods when lowering below it", () => {
    expect(schedulePatch(cfg, { workingDays: cfg.workingDays, periodsPerDay: 4, breakAfterPeriod: 3 })).toEqual({ periodsPerDay: 4, breakAfterPeriod: 3 });
  });
  it("sends the break for a legacy config", () => {
    expect(schedulePatch({ ...cfg, breakAfterPeriod: null }, { workingDays: cfg.workingDays, periodsPerDay: 8, breakAfterPeriod: 4 })).toEqual({ breakAfterPeriod: 4 });
  });
});

describe("helpers", () => {
  it("capacity is days × periods", () => {
    expect(weeklyCapacity({ workingDays: ["MONDAY", "TUESDAY"], periodsPerDay: 7 })).toBe(14);
  });
  it("clamps the break inside the day", () => {
    expect(clampBreak(6, 5)).toBe(4);
    expect(clampBreak(2, 8)).toBe(2);
  });
  it("previews one break after the chosen period", () => {
    expect(dayPreview(3, 1)).toEqual([{ kind: "PERIOD", periodNumber: 1 }, { kind: "BREAK", afterPeriod: 1 }, { kind: "PERIOD", periodNumber: 2 }, { kind: "PERIOD", periodNumber: 3 }]);
    expect(dayPreview(2, null).some((i) => i.kind === "BREAK")).toBe(false);
  });
  it("derives form values from a config", () => {
    expect(valuesFromConfig({ ...cfg, breakAfterPeriod: null }).breakAfterPeriod).toBe(4);
  });
});
