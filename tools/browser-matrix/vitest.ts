import { playwright } from "@vitest/browser-playwright";

type MatrixBrowser = "chromium" | "firefox" | "webkit";

function matrixBrowser(): MatrixBrowser {
  const value = process.env.OFD_BROWSER ?? "chromium";
  if (value === "chromium" || value === "firefox" || value === "webkit") return value;
  throw new Error(`Unsupported OFD_BROWSER: ${value}`);
}

export function browserMatrixOptions() {
  const executablePath = process.env.OFD_BROWSER_EXECUTABLE_PATH?.trim();
  return {
    provider: playwright(executablePath ? { launchOptions: { executablePath } } : undefined),
    instances: [{ browser: matrixBrowser() }],
  };
}
