## Verification

- No `.ccg/spec` directory exists.
- `npm --prefix electron run build` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run desktop:prepare` passed and created `electron/local-server/runtime/node.exe`.
- Stopped any running `LuggageTag.exe`, removed old `electron/dist`, and ran `npm --prefix electron run electron:pack`; packaging passed.
- Confirmed `electron/dist/win-unpacked/resources/local-server/runtime/node.exe` exists.
- Confirmed packaged `electron/dist/win-unpacked/resources/app/build/src/local-backend.js` resolves `runtime/node.exe` before falling back to system `node`.
- Started the packaged local server with `electron/dist/win-unpacked/resources/local-server/runtime/node.exe` on port `3199`; `/health` returned successfully.

## Notes

- The generated `.tmp-desktop-data` health-check directory was removed before commit.
- The exact CCG command-line dual-model review wrapper is unavailable in this environment, so review was completed locally and recorded in `review.md`.
