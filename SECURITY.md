# Security policy

This project accepts arbitrary telemetry but never executes log messages, shell commands or generated remediation. The production API requires a unique bearer token, strict schemas and an exact origin. Only allowlisted static files are served. Database access is parameterized. Demo fault injection exists only in the separate local fixture and is not an API feature of the production server.

Supported release: 1.x. Do not post credentials, real incident payloads or exploitable deployment details in public issues. Report security concerns through GitHub private vulnerability reporting if enabled; otherwise contact the repository owner privately through a channel listed on their profile. Do not assume a private reporting channel exists until GitHub confirms it.

Shared-token authentication provides no tenant boundaries. Redaction is best-effort, SQLite storage is not encrypted by the application, and exported reports may contain sensitive data. Deploy behind TLS with appropriate network and host controls. Keep Node.js, the base image and GitHub Actions updated. No claim of a completed external penetration test is made.
