# Deployment Review

## Critical

- None found. Production service is running `1.4.42`, internal health is ok, and public homepage is reachable.

## Warning

- The deployment SSH file says user `gongbei`, but the key is authorized for `root`; deployment used `root`, matching the previous production deployment.
- The remote interactive `npm ci` emitted Node engine warnings for Node `v20.20.2`. The app still built and the service runs with healthy `node:sqlite`; confirm systemd Node runtime before future upgrades if the app starts using stricter Node 22-only behavior.
- Cloud server still has no local `lp/lpr`; browser users now use browser printing, and event-site silent printing should use the local desktop app.
- `npm audit` reports 1 critical vulnerability; not remediated in this task.

## Info

- Public domain verified: `https://tag.ycgg.cc.cd/`.
- Deployment used a clean Git archive, not the local working tree or generated Electron artifacts.
- Existing data directory `/opt/luggage-tag/data` was preserved.
