# Telemetry contract and external dataset import

Send one JSON object to POST /api/incidents. Unknown fields are rejected, including labels such as rootCause. Timestamps are nonnegative integer epoch milliseconds. Latency is milliseconds, errors are a fraction [0,1], CPU is a percentage [0,100].

```json
{
  "title": "Checkout degradation",
  "services": ["checkout", "database"],
  "edges": [["checkout", "database"]],
  "baselineEnd": 1735689630000,
  "metrics": [{"ts":1735689600000,"service":"checkout","latencyMs":12,"errorRate":0,"cpuPct":20}],
  "logs": [{"id":"log-1","ts":1735689600000,"service":"checkout","level":"error","message":"Dependency timed out"}],
  "traces": [{"id":"trace-1","ts":1735689600000,"caller":"checkout","callee":"database","durationMs":120,"status":"error"}]
}
```

The snippet illustrates field names only; it intentionally omits the full series. A valid incident needs **at least 10 baseline samples (ts <= baselineEnd) and 5 observation samples per service**, 2–32 services, at most 128 edges, 10,000 metric rows, 2,000 logs and 4,000 traces, all within seven days. IDs must be unique across logs and traces. Trace endpoints must follow declared edges. Duplicate metric timestamps for the same service are rejected. Empty logs/traces are supported but reduce evidence.

Use `npm run demo:live` to produce a complete valid file. Use a synchronized common observation window and a known healthy baseline, not future test labels, to choose baselineEnd. Rate/cumulative counter conversion belongs upstream; do not send cumulative error counts as errorRate.

## Wide metrics CSV mapping

External datasets vary by release and system. The CSV importer uses explicit configuration instead of guessing units or service names. It accepts a CSV with one timestamp column and multiple numeric metric columns. A mapping example:

```json
{
  "title": "External incident",
  "timestamp": {"column":"time","scale":1000},
  "baselineEnd": 1735689630000,
  "edges": [["checkout","database"]],
  "services": [
    {"name":"checkout","latencyMs":{"column":"checkout_latency_seconds","scale":1000},"errorRate":{"column":"checkout_errors_fraction"},"cpuPct":{"column":"checkout_cpu_fraction","scale":100}},
    {"name":"database","latencyMs":{"column":"database_latency_seconds","scale":1000},"errorRate":{"column":"database_errors_fraction"},"cpuPct":{"column":"database_cpu_fraction","scale":100}}
  ]
}
```

Each mapping supports `column`, optional `scale` (default 1) and optional `offset` (default 0). Empty/non-numeric mapped values fail. Select a bounded incident window before importing; CSVs over 10 MiB are rejected. The output path must not already exist.

```sh
node scripts/import-rcaeval.js data.csv mapping.json imported-incident.json
node scripts/analyze.js imported-incident.json
```

For RCAEval, inspect the chosen system's actual column names and units and write the mapping accordingly. This is a **compatible metrics adapter**, not a universal RCAEval loader. Missing required metrics must be supplied from a defensible preprocessing pipeline; the importer does not invent them. It supplies no logs or traces. Ground-truth metadata is kept in a separate evaluation manifest and must never appear in the incident object. No RCAEval accuracy is claimed until that evaluation is actually run.
