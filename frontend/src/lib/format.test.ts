import { expect, it } from "vitest";
import { formatDateTime } from "./format";

it("appointment clocks match the timezone label instead of the browser timezone", () => {
  const slot = "2026-10-29T10:30:00.000Z";
  const utc = formatDateTime(slot, "UTC");
  const india = formatDateTime(slot, "Asia/Kolkata");
  expect(utc).toContain("10:30");
  expect(india).toMatch(/(?:4|16):00/);
  expect(utc).not.toBe(india);
});
