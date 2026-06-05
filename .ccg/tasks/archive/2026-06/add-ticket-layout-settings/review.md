# Review: add-ticket-layout-settings

## External Analysis And Review

- Claude analyzer completed and recommended using the existing settings table, parameterizing PDF/direct-print paths, and passing layout data to browser print pages.
- Codex analyzer/reviewer attempts failed through `codeagent-wrapper` with exit code 1. Earlier direct `codex review` also failed because the configured provider returned 401 Unauthorized.
- Claude reviewer completed. No Critical findings.

## Findings

### Critical

- None remaining.

### Warning

- CUPS printing now re-renders the ticket PDF using current settings instead of using a stored PDF. This is intentional so reprints follow current layout, but output can differ from old stored PDFs.
- Custom Windows paper size still depends on the printer driver accepting the requested physical size.

### Info

- Direct API callers that omit imposition `productWidth` / `productHeight` now default to the saved ticket width/height.
- `/api/settings` accepts nested `ticketPrintLayout` fields and persists normalized numeric values to the existing key/value settings table.
- Browser print pages receive `ticketPrintLayout` with order data and update `@page` size from the saved settings.

## Verification

- `npm run lint` passed.
- `npm run build` passed.
- `node --check server/config.js` passed.
- `node --check server/db.js` passed.
- `node --check server/index.js` passed.
- `node --check server/orders.js` passed.
- `node --check server/pdf.js` passed.
- `node --check server/printing.js` passed.
- `createTicketPdfBuffer` generated a valid `%PDF` buffer with custom layout values.
- `getSettings()` returned the new `ticketPrintLayout` object from the existing database.
