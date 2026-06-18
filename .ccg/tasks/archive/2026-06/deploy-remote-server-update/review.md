# Review

## Deployment result

- Remote host: `162.211.183.186:12190`
- Login account used: `root`
- Service: `luggage-tag.service`
- Working directory: `/opt/luggage-tag/app`
- New release marker: `20260606140954`

## Actions completed

- Uploaded `release-v1.4.46-20260606140954.zip` to `/opt/luggage-tag/releases/`
- Extracted new release to `/opt/luggage-tag/releases/app-v1.4.46-20260606140954`
- Installed production dependencies on the server
- Backed up previous live app to `/opt/luggage-tag/backups/app-before-v1.4.46-20260606140954`
- Replaced `/opt/luggage-tag/app`
- Restarted `luggage-tag.service`

## Verification

- `systemctl status luggage-tag.service` => active running
- `curl http://127.0.0.1:3108/health` => `{"status":"ok",...}`
- `https://tag.ycgg.cc.cd/` => HTTP `200`

## Notes

- The SSH key from `D:\用户\服务器.txt` works for `root`, not for `gongbei`.
- Server deploy layout is release-directory based, not `git pull` based.
- Remote `npm install` completed with Node engine warnings because npm ran under Node `v20.20.2`, but the service itself runs with `/opt/luggage-tag/node-v24.11.1-linux-x64/bin/node`.

## Rollback

- Previous live app copy remains at `/opt/luggage-tag/backups/app-before-v1.4.46-20260606140954`
- Previous release marker was `20260605152517`
