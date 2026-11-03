# Shared QE Atlas result

A11yGate emits schemaVersion 1 alongside its native reports as `qe-result-a11ygate.json`. Native outputs and exit semantics are unchanged. The Action accepts the qe-result path input and preserves comment: false.

Contract: https://github.com/DaveEliranAssistant/qe-atlas-report/pull/1 . The reporter discovers producers dynamically. Findings are capped at 100; totals and complete native reports are retained. Run provenance comes from GITHUB_REPOSITORY/GITHUB_RUN_ID; outside Actions the fallback URL ends in /actions/runs/0 and is not evidence of a real run.

PASS means no new qualifying regressions, not accessibility certification.

Operational failures may leave no shared file when input/path validation fails before output acquisition. Configure expected-files in the reporter so this is an explicit ERROR, never a silent omission.

Tests: `node --test qe-result.test.mjs`. No baseline or assertion changes.
