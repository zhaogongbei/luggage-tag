# Frontend Flow Research

Scope: read-only analysis of `C:\Users\Administrator\luggage-tag`.

Question: does the current code satisfy the target workflow where a customer selects a color, enters an English name, clicks Print, sees no browser print dialog/preview/second confirmation, and the backend creates an order with number/time, sends it to the configured/default printer, shows success, clears the page, and supports event reset, permissions, traceability, reprint, multiple events, and version recording?

Short answer: partially. The backend already contains most infrastructure for orders, numbering, events, auth, audit logs, printer selection, and direct print. The customer-facing click path does not reliably meet the silent-print requirement because it still defaults to browser print fallback and does not use the existing `/api/orders/direct-print` endpoint.

## Existing Coverage

- Customer color selection exists via `templates` and `templateId`.
  - `src/lib/constants.js:64` defines the three templates/colors.
  - `src/pages/CustomerPage.jsx:163` renders the color buttons and updates `templateId`.

- English-name input and validation exists on both frontend and backend.
  - `src/lib/validate.js:1` uppercases, removes non-`A-Z`/space chars, collapses spaces, and caps at 12 chars.
  - `src/pages/CustomerPage.jsx:72` blocks invalid names before submit.
  - `server/orders.js:21` and `server/orders.js:25` repeat normalization/validation on the server.

- Order creation with number and timestamp exists.
  - `src/pages/CustomerPage.jsx:84` posts to `/api/orders`.
  - `server/index.js:436` exposes `POST /api/orders` behind `requireCustomerAccess`.
  - `server/orders.js:43` creates `generatedAt`.
  - `server/orders.js:45` gets the active event and `server/orders.js:46` formats the current order number.
  - `server/orders.js:51` inserts an order with `print_status = 'pending'`.
  - `server/orders.js:54` increments the active event counter only after the order insert.

- Backend direct-print capability exists.
  - `server/index.js:444` exposes `POST /api/orders/direct-print`: create order, issue access cookie, send to printer, mark printed, audit success/failure.
  - `server/index.js:509` exposes `POST /api/orders/:id/print` for staff reprint/direct print of existing orders.
  - `server/index.js:519` exposes `POST /api/orders/:id/print-ticket` for customer-access printing of an existing order.
  - `server/printing.js:55` resolves requested printer, configured printer, system default physical printer, or first physical printer.
  - `server/printing.js:75` prints on Windows using `System.Drawing.Printing.PrintDocument` and `StandardPrintController`, which avoids a browser dialog.
  - `server/printing.js:149` prints on non-Windows via `lp`/`lpr`.

- Success message and automatic page clear exist after the current successful customer path.
  - `src/pages/CustomerPage.jsx:124` shows success with order number.
  - `src/pages/CustomerPage.jsx:127` clears name, resets color, clears message, and refocuses input after 2 seconds.

- Printer configuration exists in the admin UI/API.
  - `server/index.js:483` reads printers.
  - `server/index.js:493` saves selected printer.
  - `server/index.js:500` test-prints.
  - `src/pages/AdminPage.jsx:537` renders printer settings.
  - `src/pages/AdminPage.jsx:541` lets Super Admin choose configured printer or default printer.

- Event reset and multiple-event order attribution exist.
  - `server/db.js:39` defines an `events` table.
  - `server/db.js:26` defines `orders.event_id`.
  - `server/index.js:319` creates a new active event and deactivates prior events.
  - `server/db.js:342` exposes event name/date through `toPublicOrder`.
  - `src/pages/AdminPage.jsx:513` renders new-event reset controls.
  - `src/pages/AdminPage.jsx:623` displays the event on each order row.

- Permissions and access modes exist.
  - `server/middleware.js:4` computes auth/customer access from session, invite, public/private/maintenance mode.
  - `server/middleware.js:24` implements role gating.
  - `src/lib/constants.js:22` defines deployment modes.
  - `src/pages/AdminPage.jsx:572` exposes account/role management to Super Admin.

- Traceability exists through orders and audit logs.
  - `server/db.js:67` defines `audit_logs`.
  - `server/auth.js:228` writes audit entries.
  - `server/orders.js:74` audits order creation.
  - `server/index.js:285` returns recent audit logs for Super Admin.
  - `src/pages/AdminPage.jsx:597` renders operation logs.

- Reprint exists for staff/admin.
  - `src/pages/AdminPage.jsx:627` has a per-order print button.
  - `src/pages/AdminPage.jsx:298` calls `POST /api/orders/:id/print`.
  - `server/index.js:509` prints an existing order without incrementing numbering.

- Version is recorded.
  - `package.json:3` has `1.4.40`.
  - `src/lib/constants.js:8` has `APP_VERSION = "V1.4.40"`.
  - `README.md:3` records `Version: 1.4.40`.
  - `src/pages/AdminPage.jsx:509` displays `APP_VERSION` in settings.

## Gaps

- The default customer click path still opens browser print UI.
  - `src/pages/CustomerPage.jsx:118` redirects normal browser users to `/ticket/:id?autoPrint=1`.
  - `src/pages/CustomerTicketPrintPage.jsx:36` calls `window.print()`, which opens browser/system print UI.
  - This violates "no browser print dialog", "no preview", and "no second confirmation" unless `autoPrint` is explicitly enabled and the user has staff permission.

- The customer page does not use the existing atomic direct-print endpoint.
  - `server/index.js:444` already has `/api/orders/direct-print`, which does create + print + mark printed in one endpoint.
  - `src/pages/CustomerPage.jsx:84` still creates first via `/api/orders`, then conditionally prints via native ESC/POS, staff-only `/api/orders/:id/print`, or browser fallback.

- The current `autoPrint` web path is permission-incompatible for public/invite customer use.
  - `src/pages/CustomerPage.jsx:109` calls `POST /api/orders/${data.id}/print` when `autoPrint` is true.
  - `server/index.js:509` gates that route with `requireRole(["super_admin", "admin"])`.
  - Customers in public/invite mode have `requireCustomerAccess`, not staff role, so this path can fail with 401/403 instead of silently printing.

- Successful `/api/orders/:id/print` does not mark orders as printed.
  - `server/index.js:513` prints the order and `server/index.js:514` audits it, but no `UPDATE orders SET print_status = 'printed'` occurs.
  - `/api/orders/direct-print` does mark printed at `server/index.js:452`.
  - Result: even staff/admin reprints or customer `autoPrint` success can leave the order status as `pending`.

- Print failure UX does not fully match the target customer workflow.
  - Existing `/api/orders/direct-print` correctly preserves the order on print failure and returns `id`, `orderNo`, `generatedAt` at `server/index.js:455`.
  - `CustomerPage` does not call that endpoint, so it does not show the preserved order information from this failure path.
  - Current two-step flow can create an order and then fail printing with a generic error from `src/pages/CustomerPage.jsx:134`; the order remains reprintable, but the UI does not explicitly surface "order saved, reprint from admin".

- Browser-print routes remain first-class in routing and docs.
  - `src/main.jsx:99` serves `/print/:id`.
  - `src/main.jsx:107` serves `/ticket/:id`.
  - `src/main.jsx:111` serves `/print-layout` and `/print-a4`.
  - `README.md:84` to `README.md:118` still describes browser print as V1/V1.2/V1.3 and says local print service is "reserved", despite code having live direct-print APIs.

- Client/native fallback can still break the no-dialog requirement.
  - `src/pages/CustomerPage.jsx:95` detects Capacitor native.
  - `src/pages/CustomerPage.jsx:104` falls back to `/ticket/:id?autoPrint=1` if native ESC/POS fails.
  - That fallback uses browser print UI through `window.print()`.

- Version metadata is present but not consistently single-sourced.
  - `package.json:3` and `src/lib/constants.js:8` both hardcode `1.4.40`.
  - Any version bump must update both plus README, or the app can display a stale version.

## Recommended Changes

- Change `CustomerPage.printOrder()` to call `POST /api/orders/direct-print` as the primary web/kiosk path.
  - Send `{ templateId, customerText: finalName, pngDataUrl }`.
  - Use the returned `orderNo`, `printerName`, and `message`.
  - Remove the normal browser redirect to `/ticket/:id?autoPrint=1` from the customer flow.
  - Keep one explicit staff/admin browser-print path only if needed for legacy admin workflows, not for customer print.

- Remove the customer-page dependency on `autoPrint` for silent printing.
  - Silent print should be the default behavior for the target customer workflow.
  - `creatorAutoPrint` can remain as a legacy/diagnostic flag only if product wants a fallback mode, but the target flow should not require it.

- If preserving native Android/Electron ESC/POS is required, define platform precedence clearly.
  - Option A: always call backend `/api/orders/direct-print` for all web/electron/kiosk devices.
  - Option B: native app may use `EscPos.print`, but failure should show "order saved, print failed" or call a backend reprint endpoint, not redirect to `window.print()`.

- Update `POST /api/orders/:id/print` to mark `print_status = 'printed'` on success, or document that it is intentionally "send only".
  - Recommended: update status on success for consistent admin order state.
  - Reprint should still not increment numbering.

- Consider using `/api/orders/:id/print-ticket` only for "print existing customer-owned order" flows.
  - For new customer orders, `/api/orders/direct-print` is better because it creates, prints, marks status, audits, and preserves failure trace in one request.

- Make print-failure messaging explicit in `CustomerPage`.
  - If direct-print returns an order id/order number on failure, show that the order was saved and can be reprinted by staff.
  - Keep the page uncleared on failure so staff/customer can retry or inspect.

- Update README and version metadata when implementing the workflow change.
  - Bump `package.json` and `APP_VERSION`.
  - Update README version and Printing section from "reserved" to the actual direct-print behavior.

## Risks

- Silent printing requires the backend to run on the machine that can access the physical printer.
  - `server/printing.js:75` uses Windows local printing.
  - `server/printing.js:149` requires CUPS `lp`/`lpr` on non-Windows.
  - If frontend runs on a tablet while backend runs elsewhere, the print job goes to the backend host printer, not the tablet.

- Browser environments cannot silently print by themselves.
  - Any path using `window.print()` (`/ticket`, `/print`, `/print-layout`, `/print-a4`) can show browser/system UI and should not be part of the target customer path.

- Public/invite deployment exposes order creation and direct print to anyone with customer access.
  - `requireCustomerAccess` allows public mode and invite-cookie users.
  - Rate limiting exists at `server/index.js:109`, but public mode can still send real print jobs. Operational deployments should prefer private/invite with physical supervision.

- Direct print success only confirms the OS print API/spool accepted the job, not that paper physically printed.
  - The 3-second target should be treated as "spool accepted normally".
  - Printer offline/paper-out states may still produce false positives depending on driver behavior.

- Current order-number compensation after file-write failure is not rollback-complete.
  - `server/orders.js:43` to `server/orders.js:57` commits number increment before PNG/PDF write.
  - `server/orders.js:70` to `server/orders.js:72` deletes the order if file write fails, but does not decrement the event counter. This avoids duplicate numbers but may leave gaps.

- The existing Windows direct print output is plain white ticket text, not the full visual template.
  - This appears intentional per README V1.4.3, but if the customer expects the selected color/template to print physically, `server/printing.js` currently ignores `template_id`.

- Audit log retention is capped.
  - `server/config.js:34` defaults to 5000 entries.
  - Long events can lose older audit detail unless retention is configured.

## Tests

Recommended verification after implementation:

- Customer web silent print success
  - Given customer access and a configured/default physical printer, submit a valid English name.
  - Assert one call to `/api/orders/direct-print`.
  - Assert no navigation to `/ticket`, `/print`, `/print-layout`, or `/print-a4`.
  - Assert no call to `window.print()`.
  - Assert success message includes the returned order number/printer message.
  - Assert name and color reset after success.

- Customer web print failure
  - Mock `/api/orders/direct-print` returning 500 with `{ id, orderNo, generatedAt, message }`.
  - Assert the UI shows that the order was saved and can be reprinted.
  - Assert the page does not clear the entered name/template on failure.

- Permission/access tests
  - Public or invite customer can create and direct-print through `/api/orders/direct-print`.
  - Public or invite customer cannot call staff-only `/api/orders/:id/print`.
  - Super Admin/Admin can call `/api/orders/:id/print` for reprint.
  - Client users only see their own orders where ownership filtering applies.

- Order state tests
  - `/api/orders/direct-print` creates an order, increments the active event number, writes PNG/PDF, marks `print_status = 'printed'` on success, and writes audit log.
  - `/api/orders/direct-print` preserves the order as `pending` and returns order id/order number on print failure.
  - `/api/orders/:id/print` should mark printed on success if the recommended change is applied.

- Event reset/multiple event tests
  - Reset event as Super Admin.
  - Create a new order and verify it uses the new event prefix/start number.
  - Verify old orders keep old event/name/date/order number and remain searchable/reprintable.

- Browser-print regression tests
  - Confirm `/ticket/:id`, `/print/:id`, `/print-layout`, and `/print-a4` are not reachable from the customer Print button in the target flow.
  - If legacy admin routes remain, test they are staff-only where appropriate.

- Version/doc tests
  - Verify `package.json`, `src/lib/constants.js`, and README version match.
  - Verify admin settings displays the new `APP_VERSION`.

