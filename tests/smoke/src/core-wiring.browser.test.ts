import { bindingPolicyVersions } from "@ofd-compose/binding-core";
import { moduleId as layoutCoreId } from "@ofd-compose/layout-core";
import { moduleId as typographyCoreId } from "@ofd-compose/typography-core";
import { expect, it } from "vitest";

it("runs the shared core packages in a real browser", () => {
  expect(bindingPolicyVersions).toContain("strict-1");
  expect(bindingPolicyVersions).toContain("legacy-compat-1");
  expect(layoutCoreId).toBe("@ofd-compose/layout-core");
  expect(typographyCoreId).toBe("@ofd-compose/typography-core");
});

it("browser mode actually provides a DOM", () => {
  expect(typeof window).toBe("object");
  expect(typeof document.createElement("div").textContent).toBe("string");
});
