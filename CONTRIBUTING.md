# Contributing

Use Node.js 24.x. Run `npm run verify` and `npm run demo:live -- --check` before submitting a change. No install step is necessary for the current dependency-free implementation.

Bug reports should contain a minimal **synthetic/redacted** input, expected behavior, actual behavior, Node version and reproduction steps. Never attach production logs with secrets.

Model changes must explain the hypothesis, preserve incident-level train/test separation, compare with existing baselines, and commit updated artifacts and benchmark results together. Report negative results. Do not claim causal inference, calibration, real-data accuracy or automatic remediation unless the implementation and evaluation support those claims.

Keep production safeguards fail-closed. Tests should exercise failures and boundaries, not only successful demos. New third-party dependencies require a justification and an update to the dependency policy in scripts/check.js. Use focused pull requests with evidence of validation.
