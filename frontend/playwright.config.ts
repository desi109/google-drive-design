import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: ["local.spec.ts", "recovery.spec.ts"],
  workers: 1,
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:8189",
    headless: true,
  },
  reporter: "list",
});
