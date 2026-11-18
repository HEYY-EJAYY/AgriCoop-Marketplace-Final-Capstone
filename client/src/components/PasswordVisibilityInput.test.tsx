import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PasswordVisibilityInput } from "./PasswordVisibilityInput";

describe("PasswordVisibilityInput", () => {
  it("provides an accessible keyboard-operable visibility button without changing the initial field type", () => {
    const markup = renderToStaticMarkup(React.createElement(PasswordVisibilityInput, {
      autoComplete: "new-password",
      value: "",
      onChange: () => undefined,
    }));

    expect(markup).toContain('type="password"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).toContain('aria-pressed="false"');
  });
});
