# Review

## External Wrapper

- CCG `codeagent-wrapper` was not available at `C:\Users\Administrator\.claude\bin\codeagent-wrapper`, so the required external codex/Claude wrapper review could not run in this environment.
- Used two parallel CCG review subagents instead.

## Review A

### Critical
- None.

### Warning
- Staff reprint endpoint could physically print soft-deleted orders while leaving status unchanged.
- `autoPrint` / `autoReturn` were still computed and passed after customer flow no longer used them.

### Info
- Customer print path posts only to `/api/orders/direct-print` and no longer opens browser print pages.
- Direct-print success/failure responses are traceable.
- Version metadata is consistent.
- Manual tests exist; no automated test script exists.

## Review B

### Critical
- None.

### Warning
- Staff reprint endpoint should reject soft-deleted orders before printing.
- PNG/PDF generation failure after DB commit could leave partial files.
- 3-second target depends on printer driver/spooler responsiveness and should be documented.

### Info
- Direct-print preserves pending orders on print failure.
- Printer command injection risk is low because `execFile` and environment variables are used.
- Virtual-printer detection is heuristic but useful.

## Fixes Applied After Review

- `POST /api/orders/:id/print` now rejects soft-deleted orders with 409 before sending to printer.
- Order file generation failure now deletes any partially written PNG/PDF files after removing the failed order row.
- Removed stale `autoPrint` / `autoReturn` customer-page props and settings UI toggles.
- README and TEST_CASES now document the 3-second target as dependent on healthy local print service/driver/spooler behavior.

## Final Verification

- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: no whitespace errors; only CRLF conversion warnings.
- Temporary backend `/health` on `PORT=3101`: returned `status: ok`.
- Customer print grep confirms `src/pages/CustomerPage.jsx` uses `/api/orders/direct-print` and does not call `window.print`, `window.open`, or `window.location.href`.

## Residual Risk

- A successful OS print call means the job was accepted by the local OS/driver path, not proof that paper physically exited the printer. True paper-completion tracking would require printer/job polling or a print-attempt table with device feedback.
