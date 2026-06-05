# Review: adjust-thermal-ticket-layout

## External Review

- Claude reviewer completed twice.
- Codex reviewer via `codeagent-wrapper` failed twice with exit code 1.
- Direct `codex review --uncommitted` also failed because the configured provider returned `401 Unauthorized`.

## Findings

### Critical

- None remaining.

### Warning

- Thermal printer drivers may ignore a custom 80mm x 60mm paper size unless that size is configured in the driver. The code now requests 80mm x 60mm consistently, but the physical printer setup must match.
- Very long names can still exceed the 80mm width visually. Existing order validation limits names to 12 English letters/spaces, which keeps this acceptable for the requested examples.

### Info

- Browser print, PDF export/CUPS, Windows direct print, and A4/A3/A5 imposition defaults now use 80mm x 60mm ticket dimensions.
- Ticket content uses top layout with name, order number, then time. The top origin is 6mm plus configurable top offset, clamped to the ticket top for backend/PDF safety.
- Backend parameters support both `LUGGAGE_TAG_TICKET_TOP_OFFSET_MM` and `ticket_top_offset_mm`; use `-5` to move content up and `5` to move down.

## Verification

- `npm run lint` passed.
- `npm run build` passed.
- `node --check server/config.js` passed.
- `node --check server/pdf.js` passed.
- `node --check server/printing.js` passed.
- `createTicketPdfBuffer` generated a valid `%PDF` buffer for `ZHAO / No.0010 / 2026-06-05`.
- `ticket_top_offset_mm=-5` was read as `-5`.
