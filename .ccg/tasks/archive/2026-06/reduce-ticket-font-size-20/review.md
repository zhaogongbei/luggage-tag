# Review: reduce-ticket-font-size-20

## Result

- Ticket font defaults were reduced by 20%.
- Browser print, PDF generation, and backend direct-print defaults use the new font sizes.
- `npm run lint` passed.
- `npm run build` passed.
- `node --check server/config.js` passed.
- `createTicketPdfBuffer` generated a valid `%PDF` buffer.

## Desktop Packaging

- `npm run desktop:pack` ran `desktop:prepare` successfully.
- Packaging failed while removing `electron/dist/win-unpacked/d3dcompiler_47.dll` with `Access is denied`, likely because an existing unpacked desktop app process was still holding files open.
- Source and `electron/local-server` were prepared with the latest build; `electron/dist/win-unpacked` needs a retry after closing the running desktop app.
