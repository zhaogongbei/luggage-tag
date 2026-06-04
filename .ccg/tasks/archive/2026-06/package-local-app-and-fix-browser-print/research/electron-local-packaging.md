# Electron Local Packaging And Silent Print Research

## Files Found

- `package.json` - root app scripts currently cover web dev/build/lint only; no root command orchestrates Electron packaging.
- `electron/package.json` - Capacitor Electron scaffold with `build`, `electron:start`, `electron:pack`, and `electron:make`.
- `electron/src/index.ts` - Electron main entry; initializes Capacitor window only, no local API server lifecycle.
- `electron/src/setup.ts` - BrowserWindow/setup wrapper; can load either `capacitor.config.server.url` or bundled `electron/app`.
- `electron/src/preload.ts` - only loads Capacitor runtime bridge and logs a message.
- `electron/live-runner.js` - watches Electron `src/**/*`, rebuilds TypeScript, and relaunches Electron.
- `electron/electron-builder.config.json` - portable Windows package config including only Electron assets/build/app files.
- `electron/capacitor.config.json` - currently points Electron at remote `https://tag.ycgg.cc.cd`.
- `server/index.js` - Express API, static SPA serving in production, order creation, printer, direct print, and reprint endpoints.
- `server/printing.js` - platform-specific direct local printer implementation via PowerShell on Windows and CUPS on Unix.
- `src/pages/CustomerPage.jsx` - kiosk creation path calls `/api/orders/direct-print`.
- `src/pages/AdminPage.jsx` - printer listing/selection/test and admin reprint path.
- `src/pages/PrintPage.jsx`, `src/pages/CustomerTicketPrintPage.jsx`, `src/pages/ImpositionPrintPage.jsx` - browser print-dialog pages using `window.print()`.
- `src/lib/constants.js` - API base defaults to same origin in production and `:3001` in Vite dev.

## Dependencies

Current runtime dependency map:

```text
CustomerPage
  -> apiFetch("/api/orders/direct-print")
  -> server/index.js createOrderFromPayload()
  -> server/index.js printOrderTicket()
  -> server/printing.js printTicketDirect()
  -> Windows: powershell.exe + System.Drawing.Printing.PrintDocument
  -> Unix-like: lp/lpr through CUPS

AdminPage
  -> apiFetch("/api/printers", "/api/printers/selected", "/api/printers/test")
  -> server/printing.js getSystemPrinters()/printTicketDirect()
  -> apiFetch("/api/orders/:id/print")
  -> server/index.js printOrderTicket()

Electron main
  -> getCapacitorElectronConfig()
  -> ElectronCapacitorApp.init()
  -> setup.ts loadMainWindow()
  -> if electron/capacitor.config.json has server.url: BrowserWindow.loadURL(remote)
  -> otherwise: electron-serve(electron/app)

Packaging
  -> electron/package.json electron:make
  -> electron-builder.config.json files: assets, build, capacitor.config, app
  -> does not include root server, root dist, root package dependencies, or data directory handling
```

Important compatibility dependency:

```text
server/db.js imports node:sqlite DatabaseSync
  -> requires a Node runtime with node:sqlite support
  -> root package requires Node >=22.5.0
  -> current Electron package uses Electron 26.6.10, whose embedded Node runtime is older than that requirement
```

## Patterns

- Root server binds to localhost by default through `server/config.js:14-15`, which is appropriate for local desktop mode.
- Production Express serves `dist` at `server/index.js:114-116` and falls back to `dist/index.html` at `server/index.js:562-565`.
- Root frontend production API base is same-origin unless `VITE_API_BASE` is set, see `src/lib/constants.js:1-5`.
- Direct kiosk printing already uses the server endpoint, not a browser print API, in `src/pages/CustomerPage.jsx:71-88`.
- Admin printer management already uses server printer endpoints in `src/pages/AdminPage.jsx:136-149` and `src/pages/AdminPage.jsx:373-382`.
- Admin reprint already calls direct server print at `src/pages/AdminPage.jsx:298-304`.
- Browser print fallback pages intentionally use `window.print()` with `@page` sizing:
  - `src/pages/PrintPage.jsx:10-15` and `src/pages/PrintPage.jsx:33-43`
  - `src/pages/CustomerTicketPrintPage.jsx:9-14` and `src/pages/CustomerTicketPrintPage.jsx:32-47`
  - `src/pages/ImpositionPrintPage.jsx:39-50` and `src/pages/ImpositionPrintPage.jsx:70-72`
- Server direct print marks successful direct-print orders as printed and writes audit logs at `server/index.js:444-455`.
- Failed kiosk direct-print saves the order and returns pending status, also audited, at `server/index.js:450-455`.
- Printer detection rejects virtual printers by name and selected-printer mismatch in `server/printing.js:31-77`.
- Windows silent direct print suppresses UI with `StandardPrintController` in `server/printing.js:89-92`.

## Existing Coverage

The local print backend is substantially implemented.

- `server/printing.js` can enumerate printers, select a configured/default physical printer, reject common virtual printers, and print silently through OS-level APIs/commands.
- `server/index.js` exposes the necessary API surface:
  - `POST /api/orders/direct-print` for kiosk order creation plus immediate direct print.
  - `GET /api/printers`, `PUT /api/printers/selected`, `POST /api/printers/test`.
  - `POST /api/orders/:id/print` for admin reprint.
  - `POST /api/orders/:id/print-ticket` for customer-owned ticket reprint.
- Browser fallback pages already exist and correctly use `window.print()`, which means they invoke the browser/Chromium print dialog or print UI instead of pretending ordinary browser pages can print silently.
- Electron scaffold exists and has runnable/packageable commands in `electron/package.json:15-20`.
- `electron/setup.ts` already supports loading a bundled app directory when no `server.url` is present, and loading a configured URL when it is present.
- `electron/dist/win-unpacked/LuggageTag.exe` exists from a previous build, so the scaffold has built at least once.

## Gaps

1. Electron does not currently deliver the local app workflow.

- `electron/capacitor.config.json:5-8` points to `https://tag.ycgg.cc.cd`, so packaged Electron loads a remote browser-like deployment instead of a local server/UI.
- `electron/src/index.ts:41-50` only waits for Electron readiness, sets CSP, initializes the window, and checks updates. It does not start, monitor, or stop `server/index.js`.
- `electron/electron-builder.config.json:7-12` includes only Electron `assets`, compiled Electron `build`, `capacitor.config.*`, and `app`; it excludes root `server/**/*`, root `dist/**/*`, root `public/**/*`, root `package.json`, and any root runtime dependencies needed by the server.
- Root `package.json:9-19` has no scripts for preparing Electron assets, syncing Vite `dist` into `electron/app`, installing Electron dependencies, or invoking Electron packaging from the root.

2. The current Electron runtime likely cannot run the current server in-process.

- `server/db.js:4` imports `node:sqlite`; root `package.json:6-8` requires Node `>=22.5.0`.
- The Electron dependency is Electron 26 (`electron/package.json:31-34`; installed reports `v26.6.10`), which predates the Node version needed for `node:sqlite`.
- Starting the server inside Electron main/utility process without upgrading Electron or changing SQLite implementation is likely to fail before the app can boot.

3. Packaged server asset paths are not defined.

- `server/config.js:7-13` sets `rootDir` relative to the checked-out project root and defaults `dataDir` to `<root>/data`.
- In an Electron package, `rootDir` and writeable `dataDir` need an explicit strategy. Data should go under `app.getPath("userData")` or a configured external directory, not the packaged resource path.
- `server/index.js:114-116` serves root `dist` only when `NODE_ENV=production`; Electron packaging must either start Express from a root-like layout with `dist` included or set/copy paths so this static serving works.
- `server/config.js:39-43` looks for brand logos in root `public`; builder must include `public/brand-logo.*` or set `LUGGAGE_TAG_BRAND_LOGO_PATH`.

4. Browser and desktop print semantics are not clearly separated in UI/config.

- Browser fallback pages are correct technically, but the kiosk path currently always calls `/api/orders/direct-print`. If the web app is opened from a normal browser against a remote server that is not attached to the desired local printer, it still attempts server-side direct print.
- There is no explicit "desktop local mode" signal exposed by Electron preload or server health metadata. The frontend cannot distinguish "local app with local printer" from "ordinary browser".
- Electron preload has no IPC bridge for print or environment detection; `electron/src/preload.ts:1-4` only loads runtime and logs.

5. Development and packaging workflows are incomplete.

- `electron/live-runner.js:17-24` only runs `npm run build` in the Electron folder and watches `electron/src/**/*`; it does not start the root API server or Vite.
- It also ignores build failures because it resolves on child exit regardless of code.
- No root command builds the web app and copies/syncs `dist` into `electron/app`.
- `electron-builder.config.json:13-16` targets only a Windows portable build. That may be fine for this Windows kiosk, but it is not a signed installer and has no shortcut/start-menu/update policy.

## Recommended Implementation

Recommended architecture: make the desktop app own a local Express server, load the UI from that local server, and keep OS-level direct printing inside `server/printing.js`.

1. Package a local server with the Electron app.

- Add an Electron main-process server lifecycle helper, for example `electron/src/local-server.ts`.
- On `app.whenReady()`, start the backend before loading the window.
- Prefer a separate child process for isolation and crash handling, but do not use Electron's old embedded Node runtime for the current server unless Electron is upgraded to a Node runtime compatible with `node:sqlite`.
- Viable approaches:
  - Upgrade Electron to a version embedding Node with `node:sqlite`, then run the server through Electron/utility process.
  - Or package a Node runtime alongside Electron and spawn that Node executable with `server/index.js`.
  - Or replace `node:sqlite` with a package compatible with Electron packaging, then rebuild native modules if needed. This is a larger database-risk change.

2. Make Electron load localhost, not the remote URL.

- Remove `server.url` from `electron/capacitor.config.json` for local packages, or override it at runtime.
- After starting Express, load `http://127.0.0.1:<port>` in `setup.ts`/`index.ts`.
- Keep `server/config.js` default host as `127.0.0.1` for local desktop. Avoid `0.0.0.0` unless intentionally exposing LAN access.
- Set environment for the spawned backend:
  - `NODE_ENV=production`
  - `LUGGAGE_TAG_HOST=127.0.0.1`
  - `PORT=<chosen local port>`
  - `LUGGAGE_TAG_DATA_DIR=<Electron userData>/data`
  - optionally `LUGGAGE_TAG_BRAND_LOGO_PATH=<resources/public/brand-logo.png>`

3. Include the required files in Electron builder output.

- Update `electron/electron-builder.config.json` to include root production server and static assets through `extraResources` or `files`, for example:
  - root `server/**/*`
  - root `dist/**/*`
  - root `public/**/*`
  - root `package.json` if needed for module resolution
  - required root `node_modules` dependencies, or a bundled server output
  - optional packaged Node runtime if using external Node
- Keep `asar: false` or unpack server/runtime files if child processes or direct file paths need normal filesystem access.
- Avoid bundling mutable `data/` as app resources. Data belongs in userData or an installer-selected path.

4. Add root scripts to make packaging repeatable.

Suggested root-level scripts:

```json
{
  "build:web": "vite build",
  "electron:build": "npm run build:web && npm --prefix electron run build",
  "electron:dev": "npm run build:web && npm --prefix electron run electron:start-live",
  "electron:pack": "npm run build:web && npm --prefix electron run electron:pack",
  "electron:make": "npm run build:web && npm --prefix electron run electron:make"
}
```

If `electron/app` remains the bundled UI directory, add a script to copy root `dist` into `electron/app` before Electron build. If Electron loads Express localhost in production, copying into `electron/app` is unnecessary, but root `dist` must be packaged with the server.

5. Clarify browser fallback.

- Keep `window.print()` pages for browser/manual print flows; ordinary browsers cannot silently print to local printers.
- For kiosk creation in normal browser mode, consider adding a non-silent fallback path:
  - create order through `POST /api/orders`
  - open `/ticket/:id/print?autoReturn=true` or similar
  - allow browser print dialog
- Gate this with an explicit capability signal, for example:
  - server endpoint `/api/runtime` returns `{ localDesktop: true/false, directPrintAvailable: true/false }`
  - Electron local server sets `LUGGAGE_TAG_DESKTOP_LOCAL=true`
  - optional preload exposes `window.luggageTagRuntime = { platform: "electron" }`
- Do not use preload IPC as the primary print path unless there is a strong reason; server APIs already preserve order creation, audit logging, printer settings, and reprint behavior.

6. Improve Electron security while touching setup.

- `electron/src/setup.ts:135-140` currently has both `nodeIntegration: true` and `contextIsolation: true`. With a preload bridge and web UI, `nodeIntegration` should be `false`.
- When loading localhost, update navigation/window-open allow rules so only the local app origin and expected file/download routes are allowed.
- `autoUpdater.checkForUpdatesAndNotify()` in `electron/src/index.ts:49-50` should be conditional on configured publishing. With a portable unsigned local app, automatic update checks can fail/no-op noisily.

## Risks

- **High: Node runtime mismatch.** Current server uses `node:sqlite`; Electron 26 is not a compatible host for that API. Packaging can appear successful but fail at runtime when starting the backend.
- **High: source/data path confusion.** Server defaults assume project-root-relative `dist`, `public`, and `data`. Packaged Electron must not write into read-only packaged resources.
- **High: silent print target ambiguity.** Server-side direct print always prints on the machine running the server. Browser users connecting to a remote server will not print on their local client machine.
- **Medium: firewall/port conflicts.** Local Express needs a deterministic or discoverable localhost port. `PORT=3001` may already be in use.
- **Medium: default password/public binding.** `server/index.js:572-574` prevents default password on public host binding, but Electron local env should still set a real staff password for production use.
- **Medium: virtual printer detection is heuristic.** `server/printing.js:31-33` catches common PDF/XPS/OneNote/Fax/WPS names but not every virtual printer.
- **Medium: PowerShell/System.Drawing dependency.** Windows direct printing depends on `powershell.exe` and .NET drawing/printing APIs being available and permitted.
- **Medium: no print completion guarantee.** Current direct-print APIs report "sent to printer"; they do not verify physical paper output.
- **Low/Medium: builder target.** Portable build is easy to distribute but has no installer-time printer/data setup, signing, or update policy.
- **Security: BrowserWindow nodeIntegration.** Leaving `nodeIntegration: true` increases renderer compromise blast radius.

## Build/Verification Commands

Current commands that already exist:

```powershell
# Root web build/lint
npm run build
npm run lint

# Root local web/backend development
npm run dev
npm run server
npm run client

# Electron-only build and packaging
cd electron
npm run build
npm run electron:start
npm run electron:pack
npm run electron:make
```

Recommended verification sequence after implementation:

```powershell
# 1. Verify root web/server quality
npm run lint
npm run build

# 2. Verify server starts with local desktop env
$env:NODE_ENV="production"
$env:LUGGAGE_TAG_HOST="127.0.0.1"
$env:PORT="3001"
$env:LUGGAGE_TAG_DATA_DIR="$pwd\\.tmp-local-data"
node server/index.js

# 3. In another shell, verify local server API
Invoke-RestMethod http://127.0.0.1:3001/health

# 4. Verify printer enumeration on the same machine
# Requires staff auth in the current API design, so use the UI or an authenticated request.

# 5. Verify Electron TypeScript build
cd electron
npm run build

# 6. Verify unpacked package
npm run electron:pack
.\dist\win-unpacked\LuggageTag.exe

# 7. Verify distributable package
npm run electron:make
```

Additional runtime checks:

- Launch packaged app with no external browser open; confirm it starts its own backend and loads `http://127.0.0.1:<port>`.
- Confirm `LUGGAGE_TAG_DATA_DIR` resolves to an Electron userData location and creates SQLite/export/backup files there.
- In Admin, refresh printer list, select a physical printer, and run test print.
- In kiosk creator, create one order and confirm it calls `/api/orders/direct-print`, prints silently, marks `print_status=printed`, and records audit log.
- Disconnect/disable printer, create one order, and confirm order is saved as pending with a clear failure message.
- In ordinary browser mode, confirm manual print pages open browser print UI through `window.print()` and do not claim silent local printing.
