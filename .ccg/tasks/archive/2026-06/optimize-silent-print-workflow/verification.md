# Verification

- `npm run lint`: passed
- `npm run build`: passed
- Temporary backend health check on `PORT=3101`: `/health` returned `{ "status": "ok" }`
- Customer flow grep: `src/pages/CustomerPage.jsx` posts to `/api/orders/direct-print` and no longer uses `/ticket`, `window.location.href`, `window.open`, or `window.print`.
- Legacy browser print pages remain only for existing staff/preview/batch print routes, outside the customer one-click print path.
