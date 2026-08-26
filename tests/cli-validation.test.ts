import { describe, expect, it } from "vitest";
import { parseFreePeriod, validDate } from "../src/cli.js";

describe("CLI argument validation", () => {
  it("accepts real dates and rejects malformed calendar dates", () => {
    expect(validDate("2026-02-28")).toBe("2026-02-28");
    expect(() => validDate("2026-02-30")).toThrow();
    expect(() => validDate("2026/02/28")).toThrow();
  });

  it("limits classroom free periods to the website range", () => {
    expect(parseFreePeriod("0")).toBe(0);
    expect(parseFreePeriod("13")).toBe(13);
    expect(() => parseFreePeriod("14")).toThrow();
    expect(() => parseFreePeriod("-1")).toThrow();
  });
});
