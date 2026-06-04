# Requirements

User statement: Because browsers cannot call a local printer silently without a popup, the project should be packaged as a local desktop app, continue completing the task, and then fix browser printing behavior.

Interpretation:
- Silent no-dialog physical printing must be delivered through a local desktop app/runtime, not ordinary browser pages.
- Browser mode should still have a correct fallback print workflow, but it may use browser print dialog/preview because browser silent printing is not possible.
- Existing server-side direct print and Electron/Capacitor assets should be reused where practical.
- Preserve order creation, numbering, activity reset, permissions, traceability, and reprint.
- Produce a package/build path for local app and document how to use it.

Success criteria:
- Local app can run the web UI plus backend/local print capability in one desktop-controlled workflow.
- Customer kiosk flow in local app uses silent local direct print.
- Browser flow does not pretend to be silent; it uses a clear browser print fallback without breaking order creation/reprint.
- Build/lint pass, and desktop package/build commands are verified as far as possible on this Windows machine.
