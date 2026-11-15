# Deployment and operations

## Supported boundary

One Node.js 24.x process, one SQLite database and one trusted operator/team sharing an API token. Suitable for bounded incident review behind a trusted HTTPS gateway. There is no multi-tenant isolation, horizontal scaling, high-availability failover, streaming ingestion or autonomous remediation. Validate the model on representative incidents before relying on it operationally.

## Configure

Generate a random token locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy .env.example to .env and set API_TOKEN and APP_ORIGIN. Never commit .env. For a local production-mode check, use APP_ORIGIN=http://127.0.0.1:3000. For a reverse proxy, use the external HTTPS origin, without a trailing slash or path. Compose reads .env automatically. Direct Node invocation can use `node --env-file=.env src/server.js`.

Production startup fails when the token is shorter than 32 characters or the origin is absent. A non-loopback bind is disallowed without a token even in development. The app does not generate a shared fallback key.

| Setting | Default | Meaning |
|---|---|---|
| HOST | 127.0.0.1 | Bind interface; container uses 0.0.0.0 |
| PORT | 3000 | Listening port |
| NODE_ENV | development | Set production for mandatory token/origin |
| API_TOKEN | absent | >=32-character shared token |
| APP_ORIGIN | local request origin | Exact external origin in production |
| DB_PATH | data/incidents.db | Durable SQLite path |
| DEMO_ENABLED | true in development | False by default in production |
| RETENTION_DAYS | 7 | 1–365 days; enforced on startup and API reads/writes |
| MAX_INCIDENTS | 500 | 1–10000 records; oldest records pruned |
| RATE_LIMIT | 120 | API requests per socket IP per minute |

## Container

```sh
docker compose up --build -d
docker compose logs -f
```

Build runs the verification suite before creating the runtime image. Runtime uses a non-root user. Compose applies a read-only root filesystem, persistent data volume, dropped Linux capabilities, no-new-privileges and CPU/memory/PID limits. Only loopback port 3000 is published. Terminate TLS at a reverse proxy; preserve the chosen origin and enforce authentication, request size, connection and gateway rate limits. No cloud hosting is automatically provisioned.

Use GET /health/ready for readiness and /health/live for liveness. Scrape authenticated /api/metrics for aggregate counters. Logs include event type and request ID, not raw request bodies or bearer tokens. Monitor disk growth and backup failures externally.

## Capacity and privacy

The API caps request bodies at 2 MiB and samples at documented limits. Synchronous analysis and SQLite writes block the event loop for bounded work. Perform load tests with your actual incident sizes before choosing concurrency/limits. There is no throughput or uptime SLA. Count retention does not impose a hard byte quota; configure filesystem/volume limits and monitor free space. Deleting rows does not immediately shrink SQLite files or guarantee forensic erasure.

Pre-sanitize inputs. Built-in token/password/email redaction covers common patterns only. Encrypt storage/backups at the host layer, restrict file permissions and avoid collecting credentials in the first place. No external AI service receives telemetry.

## Backups and restore

Use SQLite's online backup API rather than copying a live database without its WAL:

```sh
node scripts/backup.js data/incidents.db backups/incidents-2026-11-15.db
```

Create the backup directory first. Destination must not exist. The backup script is available in the source checkout, not the minimal runtime image. Run it against the mounted database using a compatible Node.js environment, or stop the service and back up the entire volume. Treat backups as sensitive.

To restore: stop the application, preserve the current database and WAL/SHM files together in a separate backup location, place the restored snapshot at DB_PATH in a clean directory, restore ownership, start the application, and verify readiness and representative incident retrieval. Rehearse this process before storing important data.

## Rotation and rollback

Rotate API_TOKEN in deployment configuration and restart; old tokens then fail. No browser token persists across page reload. Roll back by deploying a previous source/image revision with its matching model artifacts. Back up the database first. Schema v1 only creates the initial table; future migrations require explicit compatibility planning.

## Release acceptance

Require passing Linux/Windows tests and container smoke checks, a reviewed benchmark diff, a successful live demo, external model validation for the intended workload, gateway/TLS configuration, a restore drill, load measurements, and an operator response procedure. The repository provides the code and checks; an untested deployment does not become production-ready merely by enabling NODE_ENV=production.
