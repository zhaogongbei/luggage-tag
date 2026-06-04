# Backend Risk Review: Silent Print Workflow

Scope: read-only backend reliability/security review for `C:\Users\Administrator\luggage-tag`.

Conclusion: the backend is partially ready for on-site silent printing. It can create an order, choose a local printer, call the OS print stack without a browser dialog, preserve failed direct-print orders, and record audit rows. It does not yet provide a fully reliable or traceable 3-second event workflow because print state is modeled as `pending/printed` only, OS spool acceptance is treated as final success, reprints are not consistently reflected in order state, and customer-access print endpoints are rate-limited too broadly for a physical printer.

## Existing Coverage

- Silent local print entrypoint exists: `POST /api/orders/direct-print` creates an order, issues an order access cookie, calls `printOrderTicket(order)`, then updates `orders.print_status = 'printed'` on success (`server/index.js:444-455`).
- Direct-print failure preserves the created order and returns `id`, `orderNo`, and `generatedAt` for admin recovery/reprint (`server/index.js:455`).
- Order numbering and active-event assignment are serialized inside `BEGIN IMMEDIATE TRANSACTION`: active event lookup, order insert as `pending`, event counter increment, and legacy setting sync happen before commit (`server/orders.js:41-58`).
- Order file generation failure deletes the new order but intentionally does not roll back the event counter after the DB commit (`server/orders.js:64-72`). This avoids a half-created order, but can create number gaps.
- Events support multiple activities: orders store `event_id`, event reset deactivates old events and inserts a new active event in a transaction, and historical orders keep their event link (`server/db.js:26-38`, `server/index.js:319-330`).
- Staff reprint endpoint exists: `POST /api/orders/:id/print` prints an existing order, including soft-deleted orders, without incrementing numbering (`server/index.js:509-516`).
- Customer-access reprint endpoint exists: `POST /api/orders/:id/print-ticket` prints an existing non-deleted order if the requester has customer access and per-order access (`server/index.js:519-528`).
- Printer enumeration exists for Windows and CUPS, with 30-second cache (`server/printing.js:13-29`, `server/printing.js:35-52`).
- Default-printer fallback avoids virtual defaults and can pick the first non-virtual printer if no explicit printer is configured (`server/printing.js:55-72`).
- Print execution avoids shell interpolation for user-controlled fields: Windows uses `execFile("powershell.exe", [...])` with order data passed through environment variables, and CUPS uses `execFile(lp/lpr, args)` (`server/printing.js:75-139`, `server/printing.js:149-170`).
- Permission boundaries exist: printer selection requires `super_admin`; printer test and staff reprint require staff; direct-print requires customer access according to deployment mode (`server/index.js:493-506`, `server/middleware.js:37-46`).
- Rate limiting exists for all `/api/orders` routes at 200 requests/minute per IP/user key, plus narrower limits for imposition/layout endpoints (`server/index.js:108-112`, `server/middleware.js:59-93`).
- Audit logs exist for order create, direct-print success/failure, staff reprint success, printer selection/test, event reset, settings, and user administration (`server/auth.js:225-234`, `server/index.js:319-330`, `server/index.js:436-455`, `server/index.js:493-516`).
- Default public-host startup guard prevents exposing the server on `0.0.0.0` with the default staff password unless explicitly overridden (`server/index.js:567-576`).

## Gaps

- Direct-print is not atomic across DB and physical printing. The order is committed first, then printing is attempted, then `print_status` is updated. This is the correct direction for traceability, but it is not atomic and cannot prove paper output (`server/index.js:444-455`).
- `print_status = 'printed'` currently means "OS print call returned without throwing", not "printer completed the job." Windows `PrintDocument.Print()` and CUPS `lp/lpr` success generally mean spool acceptance, and the backend stores no OS job id, queue status, page count, error state, or completion timestamp (`server/printing.js:121-139`, `server/printing.js:163-167`).
- There is no print attempt table. The system cannot answer how many attempts happened, which printer was attempted each time, whether an attempt failed before/after spool acceptance, how long it took, or which attempt produced the current status.
- Direct-print failure remains recoverable as a pending order, but staff/customer reprint success does not update `print_status` to `printed`; only direct-print success updates it (`server/index.js:451-455`, `server/index.js:509-528`).
- Staff/customer reprint failures are not written to audit logs; they only log to console and return a 500 (`server/index.js:516`, `server/index.js:528`).
- Customer-access `/api/orders/:id/print-ticket` can repeatedly reprint an accessible order under public/invite/client access. It verifies order access, but it has no explicit reprint count, operator confirmation, reason, or low physical-printer rate limit (`server/index.js:519-528`).
- `/api/printers/selected` stores any 160-character string and does not validate that the printer exists or is non-virtual at selection time (`server/index.js:493-497`). `resolvePrinterName` rejects missing configured printers only when the printer list is non-empty, and it does not reject configured virtual printers (`server/printing.js:55-64`).
- Virtual-printer protection applies to default-printer fallback, not to explicitly configured or per-request printer names (`server/printing.js:55-72`).
- `/api/orders/:id/print` and `/api/orders/:id/print-ticket` accept `printerName` from the request body, allowing a caller with endpoint access to override the configured printer (`server/index.js:513`, `server/index.js:525`).
- There is no print-specific queue/concurrency control. Multiple direct-print requests can trigger multiple concurrent PowerShell/CUPS print processes and overwhelm a small event printer.
- The `/api/orders` 200/minute limiter is too loose for physical output and too broad to express safe printer throughput (`server/index.js:109`, `server/middleware.js:81-93`).
- Rate limits are in-memory only. Restarting the process resets limits, and multi-process deployments would not share counters (`server/middleware.js:59-101`).
- The 3-second target is at risk. Every direct-print request waits for order creation, PNG/PDF file writes, printer enumeration if cache is stale, PowerShell startup/Add-Type/GDI printing or CUPS execution, and then DB status update. Windows timeout is 60 seconds; CUPS timeout is 30 seconds (`server/orders.js:64-69`, `server/printing.js:127-136`, `server/printing.js:166`).
- There is no printer readiness endpoint or preflight gate for kiosk operation. A stale printer cache, unplugged printer, paused queue, paper-out state, or wrong default printer may only be discovered during a customer print.
- Audit retention is capped to the latest 5000 rows by cleanup, with no event-scoped export/archive. A busy public event can lose operational traceability over time (`server/config.js:33-34`, `server/db.js:237-247`).
- There is no unique DB constraint on `(event_id, order_no)`. The current single-process transaction pattern prevents normal duplicates, but the database does not enforce it if a future deployment introduces multiple processes or migration bugs (`server/db.js:26-38`).
- Activity reset is transactional, but there is no explicit "reset blocked while print jobs active" concept. A print can be spooled after an event reset while still carrying the old event/order data, which is traceable but may confuse on-site operators without a print job view.

## Recommended Changes

1. Introduce a `print_jobs` or `print_attempts` table.
   - Fields: `id`, `order_id`, `event_id`, `attempt_no`, `requested_by`, `source` (`direct`, `staff_reprint`, `customer_reprint`, `test`), `printer_name`, `requested_printer_name`, `status` (`queued`, `spooling`, `spooled`, `failed`, `cancelled`, `unknown`), `os_job_id`, `error_code`, `error_message`, `duration_ms`, `created_at`, `updated_at`.
   - Keep `orders.print_status` as a denormalized summary derived from attempts.

2. Change direct-print to explicit state transitions.
   - Create order as `pending`.
   - Insert print attempt as `queued/spooling`.
   - On OS accept, set attempt to `spooled` and order to `printed` or preferably `spooled`.
   - On exception, set attempt to `failed` and leave order `pending` or `print_failed`.
   - Return structured response: `{ order, print: { attemptId, status, printerName, durationMs, recoverable } }`.

3. Rename or expand status semantics.
   - Add statuses such as `pending`, `spooling`, `spooled`, `failed`, `printed_manual`.
   - If the UI keeps "printed", make it clear this is "sent to printer" unless OS completion polling is implemented.

4. Make reprint behavior consistent.
   - On successful `/api/orders/:id/print` and `/api/orders/:id/print-ticket`, write a print attempt and update order print summary.
   - On failure, write an audit/attempt row with the error.
   - Consider restricting customer reprint to a short-lived direct-print failure recovery token, or staff-only after kiosk page resets.

5. Add print-specific throttling and queueing.
   - Apply a low limiter to direct/reprint endpoints, for example per kiosk/client and per printer.
   - Add a single-printer FIFO queue or mutex to avoid concurrent PowerShell/CUPS jobs when the selected printer cannot handle bursts.
   - Consider idempotency keys for direct-print submissions to avoid duplicate orders from double taps or client retries.

6. Harden printer selection.
   - Validate `selectedPrinter` against a fresh printer list at save time.
   - Reject virtual printers for silent direct-print unless an explicit admin override is enabled.
   - Remove per-request `printerName` override from customer endpoint, or allow it only for staff endpoints.
   - Store selected printer metadata and last validation time.

7. Add readiness checks for event operation.
   - Endpoint: `/api/print/readiness` for staff/kiosk preflight, returning selected printer, default printer, virtual flag, cache age, OS availability, and last test-print result.
   - Kiosk should block or show staff-required state if no validated physical printer is ready.

8. Reduce 3-second user-facing risk.
   - Prefer async local queue: direct-print request creates order and queues attempt quickly, returns `202/201` within the target, and a worker handles spooling.
   - If synchronous behavior remains, pre-warm printer cache, avoid stale-cache enumeration in the critical path, and set a shorter kiosk-facing timeout with a recoverable pending order response.

9. Improve audit durability.
   - Increase retention for event deployments or archive audit logs per event before cleanup.
   - Add indexes for `audit_logs.created_at`, `audit_logs.action`, and print job fields if a print attempt table is added.

10. Add DB constraints for future safety.
    - Add a unique index on `(event_id, order_no)`.
    - Consider a partial unique active-event guard if SQLite version supports it, or enforce one active event through transaction checks.

## Security/Reliability Risks

- High: false-positive print success. The backend can mark orders `printed` even when the printer later jams, runs out of paper, or silently discards a spooled job.
- High: repeated physical print abuse in public/invite modes. Customer-access direct-print and print-ticket endpoints are intentionally exposed for kiosk use, but the current limiter permits far more requests than a physical printer should accept.
- High: configured virtual printer can defeat silent output. The fallback avoids virtual defaults, but an explicitly stored virtual printer is not rejected.
- Medium: missing print job traceability. Audit rows are useful, but without attempt records and job IDs operators cannot reliably reconcile duplicates, failed jobs, and recovery actions.
- Medium: synchronous print path can violate the 3-second target and block the kiosk for up to 30-60 seconds on OS/printer stalls.
- Medium: reprint status inconsistency. Staff/customer reprints can succeed without changing order state, leaving the dashboard pending after paper output.
- Medium: customer reprint endpoint may not match kiosk reset expectations. The order access cookie lasts two hours and can authorize repeated print-ticket calls for the same order.
- Medium: in-memory rate limits and login/invite failure counters reset on restart and do not coordinate across processes.
- Low/Medium: CORS allows same-host and private-network origins. This is convenient for LAN deployments, but public/invite modes should rely on stricter origin configuration if exposed beyond the kiosk network (`server/index.js:52-93`).
- Low: audit cleanup can remove event-critical history during high-volume operation.

## Tests

Recommended backend tests before considering the workflow production-ready:

- Unit: `createOrderFromPayload` serializes concurrent order creation and never duplicates `(event_id, order_no)`.
- Unit: invalid PNG, invalid template, and invalid customer name do not create surviving orders.
- Unit: direct-print success creates order, records audit/attempt, and updates order print summary.
- Unit: direct-print print-adapter failure preserves pending order, returns recovery identifiers, and records failure detail.
- Unit: staff reprint success updates print status/attempt summary; failure records audit/attempt.
- Unit: customer print-ticket enforces order ownership/access cookie and cannot print arbitrary order IDs.
- Unit: selected printer save rejects unknown and virtual printers when printer enumeration is available.
- Unit: default virtual printer is rejected unless a physical fallback exists.
- Integration: simulate stale printer cache, printer disappearance after cache, and CUPS/Windows command timeout.
- Integration: direct-print idempotency/double-click test should not create duplicate orders unless explicitly intended.
- Integration: per-printer rate limit/queue test under burst load.
- Integration: event reset during active print attempts preserves old order/event linkage and does not corrupt new event numbering.
- Security: verify public mode permits only customer workflow endpoints, not settings/printers/audit/admin endpoints.
- Security: verify `printerName` override is staff-only or rejected for customer endpoints.
- Performance: measure p50/p95 direct-print route time with warm cache and cold cache; assert kiosk-facing response target or queue-accept target under 3 seconds.

