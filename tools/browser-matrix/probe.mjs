import process from "node:process";
import { chromium, firefox, webkit } from "playwright";

const browserName = process.env.OFD_BROWSER ?? "chromium";
const browserTypes = { chromium, firefox, webkit };
const browserType = browserTypes[browserName];
if (!browserType) throw new Error(`Unsupported OFD_BROWSER: ${browserName}`);

const executablePath = process.env.OFD_BROWSER_EXECUTABLE_PATH?.trim();
const browser = await browserType.launch(executablePath ? { executablePath } : undefined);
try {
  process.stdout.write(
    `${JSON.stringify({
      browser: browserName,
      version: browser.version(),
      executablePath: executablePath || browserType.executablePath(),
      platform: process.platform,
      architecture: process.arch,
    })}\n`,
  );
} finally {
  await browser.close();
}
