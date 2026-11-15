# Model card: synthetic-listwise-v1

## Intended use

Offline triage and educational investigation of bounded, single-fault telemetry windows. The output is a ranked list of service hypotheses with evidence, not an instruction to restart infrastructure. The system is neither a causal discovery engine nor an autonomous remediation agent.

## Model and features

The detector computes positive robust z-like deviations from a supplied healthy baseline using median and 1.4826 × MAD. Scale floors are 5 ms latency, 0.02 error fraction and 5 CPU percentage points. Deviations are clipped to [0,12]. Three consecutive samples above 3 are required. Inferred onset is the first of those three; detection time is the third, avoiding a falsely optimistic detection-delay report.

Eight per-service features are used: median anomaly severity, anomalous-sample persistence, relative onset earliness, CPU shift, error-rate shift, error-log frequency, inbound trace-error fraction, and the fraction of anomalous transitive callers consistent with downstream propagation. Edges point from caller to dependency. Graph traversal is cycle-safe. Log message contents are not used as model instructions or semantic features.

The ranker is listwise multinomial logistic regression. Features are standardized using training data only. Training minimizes the negative log softmax score of the true service with L2 regularization, using full-batch gradient descent. There is no intercept because a shared intercept cancels within the incident's softmax. Artifacts contain feature order, means, scales, weights and the training configuration.

No-graph and learned-metrics-only models are separately fitted with the excluded coefficients fixed to zero. The simplest baseline ranks by median metric anomaly severity.

## Data and evaluation protocol

Training: 240 complete incidents, shop topology, seeds 1000–1239. Test: shop seeds 10000–10119 and chain seeds 20000–20119. Healthy-window seeds are the respective test starts plus 1000–1059. Generated service names, units and telemetry shape match the inference contract. Labels remain outside the input object. Hyperparameters are fixed in scripts/train.js; there was no hyperparameter search or real-data validation.

The simulator creates CPU, error and latency faults with propagation delay, benign spikes and occasional unrelated error logs. It is intentionally small and regular. Independent seeds do not make this independent real-world evidence. Held-out topology still shares the same generative assumptions, six services and feature distributions.

The committed benchmark reports top-1, top-3, MRR, per-fault counts, healthy false-positive rate, detection recall and median detection delay. The exact results are machine-reproducible with `npm run evaluate -- --check`. The current perfect full-ranker accuracy and equal no-graph accuracy indicate the benchmark does not demonstrate additional graph value. More difficult data is necessary before stronger claims.

## Confidence and failure modes

Softmax weights are relative candidate weights, not calibrated probabilities. A top-two weight difference below 0.15 produces an `uncertain` status; this is a heuristic, not a validated selective-classification guarantee. No sustained metric anomaly produces `no_anomaly`; logs alone cannot trigger detection.

Failures can arise from contaminated baseline periods, irregular sampling, anomalous service clocks, missing telemetry, feedback cycles, changing topology, benign load shifts, multiple simultaneous faults and distribution drift. Metric-only imports lack log/trace features used during training. Do not interpret an absence of alert as proof of health.

## Versioning

All artifacts are committed and validated at startup for schema, finite coefficients and positive scales. Any change to the simulator, features or training protocol requires rerunning training and evaluation and reviewing the resulting benchmark diff. Reproducing synthetic performance is a regression check, not a deployment acceptance test.
