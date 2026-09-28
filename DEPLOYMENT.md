# Serving, secrets and TLS basics

Local submission serving uses [compose.serving.yml](compose.serving.yml), Waitress, a read-only verified artifact bundle, and a persistent SQLite volume. It binds to host loopback. This supplies a reproducible local evaluation path; no public URL, TLS certificate, cloud secret manager connection, load test or uptime SLA has been provisioned.

## Configuration

The application reads process environment variables, not `.env` automatically. [config/environment.example](config/environment.example) is a reference. Compose environment interpolation is separate from Flask configuration.

| Variable | Purpose |
|---|---|
| `DINEIQ_ARTIFACT_ROOT` | Absolute directory containing `manifest.json`, `artifacts/`, `evidence/`; omitted means historical HDFS mode. |
| `DINEIQ_DATABASE_PATH` | Persistent SQLite file; container default `/state/operations.sqlite3`. |
| `DINEIQ_BIND`, `DINEIQ_PORT` | Waitress bind/port; native default `127.0.0.1:5000`, internal container bind `0.0.0.0:5000`. |
| `DINEIQ_ENV` | `development` for local HTTP; `production` activates required settings below. |
| `DINEIQ_SESSION_SECRET` or `DINEIQ_SESSION_SECRET_FILE` | Random persistent signing secret; production rejects absent/short values below 32 characters. Supply exactly one. |
| `DINEIQ_TRUSTED_HOSTS` | Production-required comma-separated hostnames accepted by Flask. |
| `DINEIQ_COOKIE_SECURE` | Defaults to `1` in production; production rejects `0`. |
| `DINEIQ_TRUST_PROXY` | Enable `1` only when exactly one trusted reverse proxy is the sole path to the app. |
| `DINEIQ_BOOTSTRAP_ADMIN_EMAIL` | Optional initial administrator identity. |
| `DINEIQ_BOOTSTRAP_ADMIN_PASSWORD` or `_FILE` | Optional initial password, minimum 12 characters; no built-in password. |

Generate secrets using a cryptographic random generator and inject them from the deployment's secret manager, or mount restricted secret files readable by UID 10001. Store neither secrets nor real operational databases in the submitted repository. Rotating the session secret invalidates existing sessions. Remove bootstrap variables after provisioning; they do not reset an existing administrator's password.

## Before shared HTTPS hosting

1. Choose an actual hostname and TLS-terminating reverse proxy, with certificate issuance/renewal managed by the hosting environment. Keep the application reachable only from that proxy.
2. Set `DINEIQ_ENV=production`, inject the session secret, set trusted hostnames and use Secure cookies. Add localhost to trusted hosts if retaining the supplied localhost health check, or change the probe Host appropriately.
3. If using one trusted proxy, enable `DINEIQ_TRUST_PROXY=1` and have the proxy replace forwarded client/protocol headers. Do not enable it for direct, unrestricted access.
4. Use the same HTTPS origin for frontend and `/api` so cookies and CSRF protection work. Keep bundle storage read-only, SQLite storage private and backed up, and HDFS ports unexposed.
5. Verify login, CSRF rejection, role boundaries, prediction latency, certificate renewal, restore procedures and service monitoring on the actual host. These are deployment acceptance tasks, not claims satisfied by local tests.

Production responses use HSTS, HttpOnly/SameSite cookies, `nosniff`, same-origin referrer policy, and no-store API responses. Config validation rejects missing secrets, missing trusted hosts and insecure production cookies. The app does not create certificates or redirect arbitrary HTTP traffic itself; the proxy must enforce HTTPS.

The Dockerfile uses a non-root runtime and serves with Waitress. SQLite and in-process Spark inference have not been evaluated for multi-host concurrent production traffic. Pin deployment image digests and retain an image registry copy for repeatable release distribution after review; do not treat a floating source tag as a permanent binary lock.

Implementation guidance follows the primary [Flask Waitress deployment documentation](https://flask.palletsprojects.com/en/stable/deploying/waitress/), [trusted proxy guidance](https://flask.palletsprojects.com/en/stable/deploying/proxy_fix/), and [Flask security configuration](https://flask.palletsprojects.com/en/stable/web-security/). The implemented tests cover local configuration/behavior, not certification of an external deployment.
