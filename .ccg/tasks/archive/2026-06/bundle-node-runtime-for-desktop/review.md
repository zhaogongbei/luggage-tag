## Review

### Critical

None.

### Warning

None.

### Info

- `scripts/prepare-desktop.mjs` now copies the Node executable used for packaging into `electron/local-server/runtime/node.exe`.
- `electron/src/local-backend.ts` resolves the packaged server root first, then tries `LUGGAGE_TAG_NODE_PATH`, bundled `runtime/node.exe`, and system `node` in order.
- Existing override behavior remains available because `LUGGAGE_TAG_NODE_PATH` can still force a specific runtime.
- Version records are consistent at `1.4.45`.

### Risk Notes

- The bundled runtime is copied from the packaging machine's current Node executable. Packaging should be run on Windows for the Windows desktop app so the bundled runtime is `node.exe`.
- Package size increases by the Node executable size, which is expected for a self-contained Windows desktop build.
