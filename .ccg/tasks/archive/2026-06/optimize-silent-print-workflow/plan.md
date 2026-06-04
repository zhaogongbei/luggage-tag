# Implementation Plan

## Scope
Deliver the event-site silent print workflow and record a new version.

## Decisions
- Customer-facing Print must always use the backend local print service, not browser print pages.
- Use existing `/api/orders/direct-print` as the primary customer workflow because it creates the order and sends the print job in one request while preserving the order if printing fails.
- Keep `/api/orders/:id/print` for staff reprint, but update print status on successful reprint for traceability.
- Preserve existing browser print pages only for legacy/admin batch print routes; they must not be used by the customer flow.
- Bump version from 1.4.40 to 1.4.41 and document the workflow.

## Work Items
1. Frontend customer flow
   - Update `src/pages/CustomerPage.jsx` so clicking Print calls `/api/orders/direct-print` for web/Electron/kiosk use.
   - Remove redirect fallback to `/ticket/:id?autoPrint=1` from customer flow.
   - Show short success state, refresh preview number, clear name/color quickly, and refocus input.
   - Keep native Capacitor ESC/POS path only for non-Electron native platforms if still supported, but avoid browser print fallback.

2. Backend direct print/reprint
   - Make `/api/orders/direct-print` return structured status useful for UI.
   - Mark successful staff/customer reprints as printed.
   - Keep failed direct-print orders saved as pending with order id/orderNo returned for admin reprint.
   - Add audit detail for printer name and failure.

3. Version and docs
   - Update `package.json`, `package-lock.json`, `src/lib/constants.js`, `README.md` to `1.4.41`.
   - Document that customer Print uses silent local print service and never browser print.
   - Add test cases for customer silent direct print.

4. Verification
   - Run `npm run lint` and `npm run build`.
   - Start backend briefly and call `/health`.
   - Review git diff for scope.

## Acceptance
- Customer page does not call `window.location.href` or `window.open` after creating an order.
- Customer print flow posts to `/api/orders/direct-print` and can complete without browser print UI.
- Direct print success sets order `print_status = printed`.
- Direct print failure leaves traceable pending order and returns id/orderNo.
- Staff reprint succeeds through `/api/orders/:id/print` and marks printed.
- Version displays/records `V1.4.41`.
