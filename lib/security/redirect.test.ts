import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/console/equipa", "/cockpit")).toBe("/console/equipa");
    expect(safeNextPath("/cockpit?tab=stats", "/x")).toBe("/cockpit?tab=stats");
    expect(safeNextPath(["/console", "/evil"], "/x")).toBe("/console");
  });

  it("refuses anything that leaves the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil", "", undefined, 42]) {
      expect(safeNextPath(bad, "/cockpit"), String(bad)).toBe("/cockpit");
    }
  });
});
