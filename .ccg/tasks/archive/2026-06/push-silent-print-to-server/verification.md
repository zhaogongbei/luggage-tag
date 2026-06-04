# Deployment Verification

## Local

- Commit pushed to GitHub: `11ecd38 feat: enforce silent direct printing workflow`
- Local `npm run lint`: passed before push.
- Local `npm run build`: passed before push.

## Server

Target: `162.211.183.186:12190`, deployed as root because the provided key is authorized for root, not `gongbei`.

Deployment layout:
- App: `/opt/luggage-tag/app`
- Data: `/opt/luggage-tag/data`
- Service: `luggage-tag.service`
- Internal app port from systemd environment: `127.0.0.1:3108`

Actions:
- Uploaded clean Git archive to `/tmp/luggage-tag-deploy.zip`.
- Built release in `/opt/luggage-tag/releases/app-20260604105242` using `npm ci --legacy-peer-deps` and `npm run build`.
- Verified package version `1.4.41` before switching.
- Stopped `luggage-tag.service`, moved old app to `/opt/luggage-tag/backups/app-before-v1.4.41-20260604105242`, moved release to `/opt/luggage-tag/app`, restarted service.

Verification:
- Remote package version: `1.4.41`
- `systemctl is-active luggage-tag.service`: `active`
- Internal health: `curl http://127.0.0.1:3108/health` returned `status: ok`
- Public homepage: `https://a.zhaojiabin.com/` returned HTTP 200
- Public `/health`: gateway/panel returns Access Temporarily Unavailable HTML, so internal `/health` is the valid service check.

Notes:
- First remote `npm ci` failed under npm 11 peer dependency resolution; redeployed with `npm ci --legacy-peer-deps`, matching the existing dependency set.
- npm audit reports 1 critical vulnerability in the dependency tree; this was not changed during deployment.
- Server journal indicates no local CUPS/lp/lpr print service is configured on this Linux server. Silent print works only where this backend can reach a configured printer; for the event-site direct printer, deploy/run the backend on the printer-connected host or configure CUPS/network printer on this server.
