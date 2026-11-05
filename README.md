# A11yGate GitHub Action

Composite action that runs the A11yGate CLI, appends the Markdown summary to the job summary, and can post or update one pull request comment.

Fail CI only on **new** accessibility violations from axe-core (e.g. `@axe-core/playwright`), and get a clear new / fixed / still-open summary in the job summary and an optional PR comment. Everything runs inside your runner; no data leaves it.

```yaml
- uses: DaveEliranAssistant/a11ygate-action@v1
  with:
    current: axe-results.json
    baseline: a11y-baseline.json
```

Web app: https://a11ygate.vercel.app · CLI: `npx @qe-atlas/a11ygate` · Source: https://github.com/DaveEliranAssistant/a11ygate · Licensed under MIT (see [LICENSE](LICENSE)).

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `current` | required | Axe JSON paths, one per line. |
| `baseline` | empty | Baseline JSON paths, one per line. |
| `threshold` | `serious` | `minor`, `moderate`, `serious`, or `critical`. |
| `markdown` | temp file | Where to write the Markdown summary. |
| `json` | temp file | Where to write the JSON result. |
| `update-baseline` | empty | Path to overwrite with the current results. |
| `comment` | `false` | Post or update a single pull request comment. |
| `token` | `github.token` | Token for that comment. |

The comment is marked with `<!-- a11ygate -->` and updated in place on later runs. The job summary receives the same Markdown. The step exits with the CLI code: **0** pass, **1** new violations at or above the threshold, **2** unreadable input.

Commenting on a pull request needs `pull-requests: write` in the job that runs the action. In real same-repository dogfood, `issues: write` alone returned `403 Resource not accessible by integration` even though the accessibility verdict was PASS. The corrected scope was verified in [dogfood run 41528696320](https://github.com/DaveEliranAssistant/qe-dogfood/actions/runs/41528696320) and its [posted comment](https://github.com/DaveEliranAssistant/qe-dogfood/pull/3#issuecomment-6588950073).

Keep application execution in a separate read-only job and analyze its artifact in the comment-capable job. Fork PR tokens normally cannot write comments; disable `comment` there explicitly, rather than introducing a PAT or `pull_request_target`.

## Copy-paste workflow

Put this in the repository you are auditing. The Playwright test only writes axe JSON. A11yGate is the gate, so the test should not fail on violations itself.

```yaml
name: Accessibility
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: DaveEliranAssistant/a11ygate-action@v1
        with:
          current: |
            a11y-results/home.json
            a11y-results/cart.json
          baseline: a11y/baseline.json
          threshold: serious
          comment: true
```

```ts
import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';

test('home', async ({ page }) => {
  await page.goto('https://example.com/');
  const results = await new AxeBuilder({ page }).analyze();
  await mkdir('a11y-results', { recursive: true });
  await writeFile('a11y-results/home.json', JSON.stringify(results, null, 2));
});

test('cart', async ({ page }) => {
  await page.goto('https://example.com/cart');
  const results = await new AxeBuilder({ page }).analyze();
  await mkdir('a11y-results', { recursive: true });
  await writeFile('a11y-results/cart.json', JSON.stringify(results, null, 2));
});
```

`@axe-core/playwright` belongs in the project under test. It is not a runtime dependency of the A11yGate web app.

To accept the current tree as the next baseline, run the action with `update-baseline: a11y/baseline.json` and commit the file. The gate still exits 1 when the current run has new violations, including on the run that writes the file.
