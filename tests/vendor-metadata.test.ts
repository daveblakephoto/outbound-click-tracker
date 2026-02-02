import { expect, test } from "vitest";
import {
  getActivePlacements,
  getVendorPlan,
  validateVendorMetadata
} from "../src/worker";

test("resolves vendor plan from metadata with defaults", () => {
  expect(getVendorPlan("nahid-kholghi")).toBe("basic");
  expect(getVendorPlan("unknown-vendor")).toBe("unknown");
});

test("placement activation respects active flags", () => {
  expect(getActivePlacements("dave-blake", "2026-02-15")).toContain("spotlight");
  expect(getActivePlacements("nahid-kholghi", "2026-02-15")).not.toContain(
    "spotlight"
  );
});

test("malformed metadata surfaces validation errors", () => {
  const { errors } = validateVendorMetadata({
    version: "bad" as any,
    generatedAt: 123 as any,
    vendors: null as any,
    enums: { plan: [], placement: "bad" as any },
    defaults: { plan: "unpaid", placements: {} }
  });

  expect(errors.length).toBeGreaterThan(0);
});
