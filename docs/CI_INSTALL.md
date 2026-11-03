# CI installation: pinned Action source build

## Status and prerequisites

These changes are **unreleased**. Published CLI 0.1.0 and Action v1.0.1 do not contain the new policy. The tested source-build path checks out Action commit `73e911d1b19ba4aeb52be94fa37de6c668225cf3`; its checked-in CLI is built from product commit `11df7f0f49c27727d80113795d98fa97c91a5169`. `cli-provenance.json` records the source build and bundle SHA-256, not an unrelated npm tarball. No npm installation or runtime build is needed to invoke that Action. The original parser/diff/shared adapter are reused.

Have an existing collector produce standard axe-core JSON plus explicit failed-scan and known configuration metadata. Keep an approved baseline at a trusted base revision. Never regenerate it inside a PR gate. See the [evidence policy](https://github.com/DaveEliranAssistant/a11ygate/blob/11df7f0f49c27727d80113795d98fa97c91a5169/lib/compare.ts) for the source policy (product documentation is in the review branch).

## One concrete reproducible path

Use the new `demo/a11ygate-coverage-evidence` qe-dogfood PR, workflow `.github/workflows/a11y-coverage.yml`. It exercises this exact pinned Action with twelve independently declared hypothetical inputs, original frozen baseline/hash/assertions, an acceptance proposal and real same-repository comment delivery. These cases are synthetic mutations, not a new browser scan or customer pilot. See its run/artifact receipt once CI finishes; do not equate expected-error scenarios or a successful proof job with healthy accessibility.

For a local reproduction of the same runner after checking out that consumer PR:

```sh
git clone https://github.com/DaveEliranAssistant/a11ygate-action.git ../a11ygate-action
git -C ../a11ygate-action checkout --detach 73e911d1b19ba4aeb52be94fa37de6c668225cf3
node scripts/run-a11y-coverage.mjs ../a11ygate-action a11y-baseline.json reports/a11y-coverage
```

The reports and receipt contain actual runner output; the baseline remains byte-identical. The native automated PASS example still has three open violations and explicit unassessed manual scope. The proposal accepts exactly one new `label|#synthetic-input|/accessibility` finding, retains three debts, and leaves this invocation FAIL.

## Team wiring (tested Action/report-job pattern)

Collect scans with a read-only job; analyze its data artifacts with pinned trusted tooling in a separate report job. Do not execute PR application scripts in the comment-capable job. Checkout the trusted base baseline (`github.event.pull_request.base.sha`, `persist-credentials: false`), download the scan artifact, create `reports/`, then invoke the pinned Action:

```yaml
permissions:
  contents: read
  pull-requests: write
steps:
  # Prerequisite checkouts/download: trusted baseline, pinned Action, scan artifact.
  - uses: ./a11ygate-action
    id: gate
    continue-on-error: true # retain reports, then enforce outcome below
    with:
      current: evidence/axe-results.json
      baseline: trusted/a11y-baseline.json
      threshold: minor
      json: reports/a11ygate.json
      markdown: reports/a11ygate.md
      qe-result: reports/qe-result-a11ygate.json
      comment: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository }}
  - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
    if: always()
    with:
      name: accessibility-evidence
      path: reports/
      if-no-files-found: error
      retention-days: 14
  - if: always()
    env:
      GATE_OUTCOME: ${{ steps.gate.outcome }}
    run: node -e "if(process.env.GATE_OUTCOME!=='success')process.exit(1)"
```

This is the report-job pattern, not a claim that an unspecified customer's collector has been tested. For the fully runnable tested workflow use the consumer PR above. A configured GitHub token is the job token; no PAT, secrets provisioning or elevated fork trigger is needed. Pin checkout/setup-node/download actions as in the complete consumer workflow. `continue-on-error` is only for retaining evidence; do not omit final enforcement in a real regression gate. The synthetic proof workflow instead asserts each intentionally failing/error case against its independent oracle.

## Same-repository comments and fork fallback

- Same-repo PR: isolated report job needs `contents: read` and **`pull-requests: write`**, incorporating existing permissions PR #2. `issues: write` was insufficient in original dogfood. Keep artifact upload `if: always()`.
- Fork PR: use read-only collection/reporting, comment false, native/shared artifacts and job summary. Runner also checks the actual bounded event payload/repositories/PR number and refuses comment posting for forks, invalid contexts and non-PR events before checking a token. No `pull_request_target`, PAT or security-setting workaround.
- Missing/denied comment access: `comment-status: error`, nonzero Action outcome, native report/verdict retained. CLI `exit-code` remains the native analysis exit; it is not proof of comment delivery. Reports are not silently promoted to PASS to hide permission errors.
- The consumer workflow deliberately attempts commenting once with a read-only token to prove denial, then uses a separate least-privilege write job to prove delivery. An expected denial test is not the recommended customer gate setting. Fork event tests use an explicitly mocked transport/event payload; no live outside-account fork has been claimed.
- Comments update only the marked `github-actions[bot]` comment, never human comments. Existing 1,000-comment lookup limit remains; repositories beyond it may need a separate pagination improvement.
- Unsafe path refusal occurs before mutation; use distinct fresh output files/directories, do not reuse inputs, Action control files or event payload paths as outputs. Invalid CLI input clears stale native files; malformed reports never reuse an old PASS. Artifact access/14-day retention follow GitHub rules.

## Limits and proposed metrics

Regression PASS is not accessibility clearance, legal advice or certification. Preserve existing debt and unassessed scope, review the full native JSON v2, and keep manual evidence separate. Track installation success, verified remediation time and misleading-result reports only after real observations; all are currently unmeasured. No automatic baseline approval, scanner publication, release, merge or main push is performed.
