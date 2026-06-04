# Requirements

Project: DIY 行李牌现场定制打印系统

Goal: optimize the on-site workflow so a customer selects color, enters an English name, clicks Print, and the system creates an order, assigns number/time, sends directly to the backend configured/default local printer, shows success, clears the kiosk page, and waits for the next customer.

Hard requirements:
- No browser print dialog.
- No print preview.
- No staff second confirmation.
- Directly call default/configured printer through local print service.
- Target end-to-end user-facing completion within 3 seconds where printer spool accepts job normally.
- Support event reset, permission management, order traceability, reprint, and multiple events.
- Record the new version number.

Current findings:
- Existing version: 1.4.40.
- Backend already has `/api/orders/direct-print`, `/api/orders/:id/print`, printer enumeration, settings selected printer, users/roles, events, audit logs.
- CustomerPage currently still falls back to `/ticket/:id?autoPrint=1` unless `autoPrint` is enabled, which violates the silent-print requirement.
- CustomerPage currently creates order then calls `/api/orders/:id/print` in autoPrint mode instead of using the atomic direct-print endpoint.
- Need preserve order on print failure for traceability/reprint.
