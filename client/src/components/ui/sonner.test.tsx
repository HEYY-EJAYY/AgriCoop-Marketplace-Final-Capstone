import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(path.resolve(import.meta.dirname, "../../App.tsx"), "utf8");
const toasterSource = readFileSync(path.resolve(import.meta.dirname, "sonner.tsx"), "utf8");
const cssSource = readFileSync(path.resolve(import.meta.dirname, "../../index.css"), "utf8");

describe("app-wide toast dismiss control", () => {
  it("enables sonner's close button with an accessible label on the shared Toaster", () => {
    expect(appSource).toMatch(/<Toaster[^>]*\bcloseButton\b/);
    expect(appSource).toContain('closeButtonAriaLabel: "Dismiss notification"');
  });

  it("pins the close button to the top-right corner of each toast", () => {
    expect(toasterSource).toContain('"--toast-close-button-end": "0"');
    expect(toasterSource).toContain('"--toast-close-button-start": "unset"');
  });

  it("reserves space so toast text cannot run under the close button", () => {
    expect(cssSource).toContain("[data-sonner-toast]:has([data-close-button]) [data-content]");
  });
});
