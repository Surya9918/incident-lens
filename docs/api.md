# API reference

All API routes use the same configured bearer token. This is single-operator access, not per-user RBAC. Public liveness/readiness routes disclose only operational status. API responses carry a request ID and no-store caching. Foreign browser origins are rejected; there is no wildcard CORS.

## Create

POST /api/incidents with application/json and the [telemetry contract](data-contract.md). A successful response is HTTP 201:

```json
{"id":"uuid","createdAt":1735689600000,"incident":{},"result":{"status":"diagnosed","candidates":[],"signals":[],"evidence":[],"limitations":[]}}
```

Objects above are abbreviated. Results also include summary, modelVersion and detectedAt. Status is diagnosed, uncertain or no_anomaly. Each candidate contains service, rankingWeight, anomalous, onset, evidenceIds, signed feature contributions and a deterministic explanation.

A repeated POST creates another investigation; ingestion is not idempotent. Analysis is synchronous and bounded by payload/sample limits. Persisted telemetry is pattern-redacted before analysis and storage. That is not a guarantee of complete PII removal.

## Retrieve/delete

GET /api/incidents?limit=30&offset=0 returns summaries. Limit is 1–100; offset is 0–100000. GET /api/incidents/{id} returns one complete record; DELETE removes it. Missing IDs return 404. Exports contain potentially sensitive telemetry; protect them like the database.

## Demo

POST /api/demo accepts `{"seed":30001,"clean":false}` only when demo mode is enabled. Seed must be an integer between 1 and 1,000,000. The response adds demoTruth outside the incident. That truth is not stored or passed to inference. Disable demo mode for operational deployments.

## Errors

| HTTP | Meaning |
|---|---|
| 400 | Malformed JSON |
| 401 | Missing/invalid bearer token |
| 403 | Disallowed browser origin or development Host |
| 404 | Unknown route/record or disabled demo |
| 413 | Payload larger than 2 MiB |
| 415 | Unsupported content type |
| 422 | Invalid telemetry or pagination |
| 429 | Per-connection-IP rate limit; respect Retry-After |
| 500 | Internal failure; request ID is safe to report |
| 503 | Rate-limit state capacity exhausted |

The application does not trust X-Forwarded-For. A reverse proxy makes clients share a rate bucket unless deployment architecture is changed. Set appropriate gateway limits instead of blindly trusting forwarded headers.

GET /api/metrics returns request, error and analyzed counters in Prometheus text form. Counters are process-local and reset on restart. They are not telemetry ingestion streams or durable business metrics.
