import { describe, expect, it } from "vitest";
import { parseClock, parseFreePeriod, validDate } from "../src/cli.js";

describe("CLI argument validation", () => {
  it("accepts real dates and rejects malformed calendar dates", () => {
    expect(validDate("2026-02-28")).toBe("2026-02-28");
    expect(() => validDate("2026-02-30")).toThrow();
    expect(() => validDate("2026/02/28")).toThrow();
  });

  it("accepts numeric, lunch, and evening room periods", () => {
    expect(parseFreePeriod("0")).toBe(0);
    expect(parseFreePeriod("13")).toBe(13);
    expect(parseFreePeriod("noon")).toBe("noon");
    expect(parseFreePeriod("evening")).toBe("evening");
    expect(parseFreePeriod("中午")).toBe("noon");
    expect(parseFreePeriod("傍晚")).toBe("evening");
    expect(() => parseFreePeriod("14")).toThrow();
    expect(() => parseFreePeriod("-1")).toThrow();
  });

  it("validates time ranges used by the available-room command", async () => {
    const { buildCli } = await import("../src/cli.js");
    const { program, services } = buildCli({ cacheDir: "/tmp/catalog-time-validation" });
    program.exitOverride();
    expect(parseClock("00:00", "开始时间")).toBe(0);
    expect(parseClock("24:00", "结束时间", true)).toBe(1440);
    expect(() => parseClock("24:00", "开始时间")).toThrow();
    expect(() => parseClock("24:01", "结束时间", true)).toThrow();
    await expect(program.parseAsync(["classroom", "available", "--from", "15:00", "--to", "14:00"], { from: "user" }))
      .rejects.toMatchObject({ code: "ARGUMENT_ERROR" });
    services.repository.close();
  });
});
