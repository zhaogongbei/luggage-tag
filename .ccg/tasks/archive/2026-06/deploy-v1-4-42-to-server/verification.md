# Deployment Verification

## Local

- GitHub push completed: `master` pushed to `origin`.
- Feature commit: `875266d feat: package desktop printing app`
- CCG archive commit: `2f1202c chore: archive ccg task package-local-app-and-fix-browser-print`
- Local verification before deploy:
  - `npm run lint`: passed
  - `npm run build`: passed
  - `npm --prefix electron run build`: passed
  - `npm run desktop:prepare`: passed
  - `npm --prefix electron run electron:pack`: passed
  - Packaged `resources/local-server` health check: passed

## Server

Target:
- Host: `162.211.183.186`
- SSH port: `12190`
- Deployed as `root` because the provided key is authorized for root.
- App path: `/opt/luggage-tag/app`
- Service: `luggage-tag.service`
- Internal app URL: `http://127.0.0.1:3108`
- Public URL: `https://tag.ycgg.cc.cd/`

Actions:
- Uploaded clean Git archive from current `HEAD` as `/tmp/luggage-tag-deploy-v1.4.42.tar`.
- Built release in `/opt/luggage-tag/releases/app-v1.4.42-<timestamp>`.
- Ran `npm ci --legacy-peer-deps`.
- Ran `npm run build`.
- Verified release package version `1.4.42`.
- Stopped `luggage-tag.service`, backed up old `/opt/luggage-tag/app`, moved release into place, restarted service.

Verification:
- Remote app version: `1.4.42`
- `systemctl is-active luggage-tag.service`: `active`
- Internal health: `{"status":"ok","uptime":37,"timestamp":"2026-06-04T03:38:44.143Z"}`
- Public homepage: `https://tag.ycgg.cc.cd/` returned HTTP 200 with title `DIY 行李牌定制系统`.

## Notes

- Remote install showed npm engine warnings because the interactive shell used Node `v20.20.2`, while `package.json` declares `>=22.5.0`. The running service started successfully and `node:sqlite` worked, indicating the service runtime is compatible enough for the deployed app.
- npm audit still reports 1 critical vulnerability; this deployment did not change dependency remediation scope.
- Server journal still contains prior local printer errors: the Linux server has no `lp/lpr`. This is expected for cloud deployment. Silent physical printing requires the new local desktop app or a printer-capable local/network print host.
