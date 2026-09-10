import { bindingPolicyVersions } from "@ofd-compose/binding-core";
import { moduleId as layoutCoreId } from "@ofd-compose/layout-core";
import { moduleId as typographyCoreId } from "@ofd-compose/typography-core";
import { expect, it } from "vitest";

it("resolves workspace packages in node mode", () => {
  expect(bindingPolicyVersions).toContain("strict-1");
  expect(bindingPolicyVersions).toContain("legacy-compat-1");
  expect(layoutCoreId).toBe("@ofd-compose/layout-core");
  expect(typographyCoreId).toBe("@ofd-compose/typography-core");
});

it("node mode has no DOM globals", () => {
  const g = globalThis as Record<string, unknown>;
  expect(typeof g.window).toBe("undefined");
  expect(typeof g.document).toBe("undefined");
});
