# Project-context and offline-test measurements

`preflight-20261031.json` records live connector metadata for the same backend
task before/after the classifier and dependency freshness repair. No raw user
files, model prompt history, credentials or tool output are included.

`measure-openclaw.ps1` runs the existing synthetic industry-mapping self-test
three times, sequentially, with known public configuration. Specify the registered
OpenClaw checkout, existing Node binary and a **new** output directory. It preserves
source/config hashes, caps each child at 30 seconds and records the OS peak working
set observed every 20 ms. A 256 MiB V8 heap setting is not an OS memory sandbox.
It does not run the full regression, models, financial workflows or production.

The measurements are a bounded baseline, not a before/after test optimization or
a general model-quality score. Preserve failures rather than modifying assertions.

The source-bound provider probe at `../inflight-v1/probe-installed-approval.mjs`
exercises the installed recovery function against synthetic backend state without
starting Letta. It verifies the observed stale-approval behavior, not live recovery.
