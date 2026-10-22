import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "pages.spec.ts",
  use: {
    baseURL:
      process.env.DEMO_URL ?? "http://127.0.0.1:4173/google-drive-design/",
    headless: true,
  },
  webServer: process.env.DEMO_URL
    ? undefined
    : {
        command: "npm run preview:pages",
        url: "http://127.0.0.1:4173/google-drive-design/",
        reuseExistingServer: false,
      },
  reporter: "list",
});
