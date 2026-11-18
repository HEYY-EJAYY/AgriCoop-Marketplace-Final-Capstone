# Accessibility notes

This is an implementation and verification note, **not a WCAG conformance statement**. The project has not had a complete WCAG 2.2 AA audit or a full manual assistive-technology review.

## Implemented and covered

- Password visibility uses a real button with `aria-label="Show password"` / `"Hide password"` and `aria-pressed`. It is keyboard-operable and covered by component and browser-test cases; browser execution has not yet been performed for the new Stage 6 suite.
- Confirmation dialogs use the shared Radix Alert Dialog behavior, including focus management and Escape handling. The visual fix makes the dialog surface opaque and text legible.
- The shared mobile menu is a fixed overlay with `aria-expanded` / `aria-controls`, Escape and backdrop dismissal, focus trapping, and focus return. Its focus behavior has existing implementation coverage, but has not been re-audited with a screen reader in this stage.
- The marketplace mobile order card has a named "Your order" trigger. Status labels are human-readable Title Case instead of raw enum tokens.
- Cooperative selection uses a labeled ARIA combobox. Disabled payment methods provide an availability explanation.

## Verification performed

- Automated type check, unit tests, and production build passed. Existing component tests cover password-button attributes and status label formatting.
- Stage 6 Playwright discovery found 24 desktop/mobile cases. This confirms test discovery only: no browser was launched and no keyboard or screen-reader session was performed.
- No complete axe scan or contrast audit was run as part of this work.

## Known gaps and recommended checks

- Check text, focus indicator, disabled-state, and dialog contrast against WCAG 2.2 AA, including hover/focus/disabled combinations and status colors.
- Manually test keyboard-only workflows for registration, password recovery, product moderation, association requests, cart/checkout, archive/delete/restore, and dialogs.
- Test representative flows with NVDA or another screen reader, including form errors, loading and mutation feedback, tables, combobox selection, and mobile order-sheet focus.
- Verify at browser zoom and narrow viewport widths that controls remain visible, targets are usable, and content reflows without loss.
- Run the documented Playwright suite on a disposable local/test backend, then run an automated accessibility scan and record tool/version, routes, results, and remaining violations. Do not claim conformance from a green automated scan alone.
