import { describe, expect, it } from "vitest";
import { naturalTime } from "./naturalTime.js";
const now = new Date("2026-10-27T08:00:00Z");
describe("bounded natural appointment time", () => {
  it.each([
    ["28 October at 3 pm", "2026-10-28T15:00:00"],
    ["28th of Oct, 2027 at 15:30", "2027-10-28T15:30:00"],
    ["tomorrow at 12 am", "2026-10-28T00:00:00"],
    ["28 October at 12 pm", "2026-10-28T12:00:00"],
  ])("resolves %s against the business clock", (text, value) => {
    expect(naturalTime(text, now, "Asia/Kolkata")).toEqual({ state: "known", value });
  });
  it.each(["31 February at 3 pm", "28 October at 13 pm", "28 October", "28 October 2024 at 3 pm"])("does not guess for %s", text => {
    expect(naturalTime(text, now, "Asia/Kolkata")?.state).toBe("unknown");
  });
  it.each(["28 October at 3 pm or 4 pm", "28 October or 29 October at 3 pm"])("preserves choices in %s", text => {
    expect(naturalTime(text, now, "Asia/Kolkata")?.state).toBe("ambiguous");
  });
  it.each(["not 28 October at 3 pm", "28 October at 3 pm PST", "I am Synthetic Test"])("leaves unsupported/negated input to the validated model: %s", text => {
    expect(naturalTime(text, now, "Asia/Kolkata")).toBeNull();
  });
});
