import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "https://agricoop-marketplace-final-capstone.vercel.app";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile-360", use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "mobile-375", use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
