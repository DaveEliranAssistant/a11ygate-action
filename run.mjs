import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildResult } from './qe-result.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCommentBody, findA11yComment } from './comment.mjs';

const actionDir = path.dirname(fileURLToPath(import.meta.url));
const targetLabel=(process.env.A11Y_TARGET_LABEL||process.env.GITHUB_REPOSITORY?.split('/').at(-1)||'Application').trim();
if(!targetLabel||targetLabel.length>120||/[\r\n\x00-\x1f]/.test(targetLabel))throw Error('Invalid target label');
const safeLabel=targetLabel.replace(/[\\`*_|\[\]<>]/g,'');


function splitPaths(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isYes(value) {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const safe = String(value).replace(/\r?\n/g, ' ');
  appendFileSync(file, `${key}=${safe}\n`);
}

function apiOrigin() {
  const raw = (process.env.A11Y_API_URL || 'https://api.github.com').replace(/\/$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(raw)) {
    throw new Error('The GitHub API URL must be an https origin.');
  }
  return raw;
}

async function github(pathname, { method = 'GET', body, token, api }) {
  const response = await fetch(`${api}${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'a11ygate-action',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub comment failed (${response.status}). ${text.slice(0, 300)}`);
  }
  if (!text) return null;
  return JSON.parse(text);
}

async function listComments({ api, repo, pr, token }) {
  const comments = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(
      `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
      { token, api },
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    comments.push(...batch);
    if (findA11yComment(comments) || batch.length < 100) break;
  }
  return comments;
}

async function upsertComment(markdown) {
  const pr = (process.env.A11Y_PR_NUMBER || '').trim();
  if (!/^\d+$/.test(pr)) {
    process.stderr.write(
      '::warning::A11yGate skipped the pull request comment because this event has no pull request number.\n',
    );
    return;
  }
  const token = process.env.A11Y_TOKEN || '';
  if (!token) {
    throw new Error('A token is required to post the pull request comment. Pass the token input.');
  }
  const repo = process.env.A11Y_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('The repository name is missing or not owner/name.');
  }
  const api = apiOrigin();
  const body = buildCommentBody(markdown);
  const existing = findA11yComment(await listComments({ api, repo, pr, token }));
  if (existing) {
    await github(`/repos/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: { body },
      token,
      api,
    });
    return;
  }
  await github(`/repos/${repo}/issues/${pr}/comments`, {
    method: 'POST',
    body: { body },
    token,
    api,
  });
}

function outputPaths() {
  const temp = process.env.RUNNER_TEMP || tmpdir();
  const markdown = (process.env.A11Y_MARKDOWN || '').trim() || path.join(temp, 'a11ygate-summary.md');
  const json = (process.env.A11Y_JSON || '').trim() || path.join(temp, 'a11ygate-result.json');
  return { markdown, json };
}

function runCli(markdownPath, jsonPath) {
  const cli = path.join(actionDir, 'dist', 'cli.mjs');
  if (!existsSync(cli)) {
    process.stderr.write(`A11yGate CLI bundle is missing at ${cli}.\n`);
    return 2;
  }
  const current = splitPaths(process.env.A11Y_CURRENT);
  if (current.length === 0) {
    process.stderr.write('The current input is empty. Pass one axe JSON path per line.\n');
    return 2;
  }
  const args = [cli];
  for (const file of current) args.push('--current', file);
  for (const file of splitPaths(process.env.A11Y_BASELINE)) args.push('--baseline', file);
  args.push('--threshold', (process.env.A11Y_THRESHOLD || 'serious').trim() || 'serious');
  args.push('--markdown', markdownPath, '--json', jsonPath);
  const update = (process.env.A11Y_UPDATE_BASELINE || '').trim();
  if (update) args.push('--update-baseline', update);

  const child = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (child.stdout) process.stdout.write(child.stdout.replace(/^# A11yGate .*$/m, '# A11yGate — '+safeLabel));
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) {
    process.stderr.write(`${child.error.message}\n`);
    return 2;
  }
  return child.status === null ? 2 : child.status;
}

function readSummary(markdownPath, fallback) {
  if (existsSync(markdownPath)) return readFileSync(markdownPath, 'utf8');
  return fallback;
}

function writeSummary(summary) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file || !summary || process.env.A11Y_SUMMARY === 'false') return;
  appendFileSync(file, summary.endsWith('\n') ? summary : `${summary}\n`);
}

function writeResultOutputs(jsonPath, exitCode) {
  setOutput('exit-code', exitCode);
  if (!existsSync(jsonPath)) return;
  try {
    const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
    setOutput('verdict', report.verdict ?? '');
    setOutput('new', report.counts?.new ?? '');
    setOutput('fixed', report.counts?.fixed ?? '');
    setOutput('still-open', report.counts?.stillOpen ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not read the JSON result';
    process.stderr.write(`A11yGate could not read the JSON result: ${message}\n`);
  }
}

const paths = outputPaths();
const exitCode = runCli(paths.markdown, paths.json);
if(exitCode!==2&&existsSync(paths.json)){
 const native=JSON.parse(readFileSync(paths.json,'utf8'));native.projectName=targetLabel;
 writeFileSync(paths.json,JSON.stringify(native,null,2)+'\n');
 if(existsSync(paths.markdown))writeFileSync(paths.markdown,readFileSync(paths.markdown,'utf8').replace(/^# A11yGate .*$/m,'# A11yGate — '+safeLabel));
}
const summary = readSummary(paths.markdown, '');
writeSummary(summary);
writeResultOutputs(paths.json, exitCode);
const qePath=(process.env.A11Y_QE_RESULT||'').trim()||path.join(path.dirname(paths.json),'qe-result-a11ygate.json');
if([path.resolve(paths.json),path.resolve(paths.markdown)].includes(path.resolve(qePath)))throw new Error('Shared result must not overwrite a native output');
let native=null;try{if(exitCode!==2)native=JSON.parse(readFileSync(paths.json,'utf8'));}catch{}
writeFileSync(qePath,JSON.stringify(buildResult(native,summary,exitCode),null,2)+'\n');

let code = exitCode;
if (isYes(process.env.A11Y_COMMENT)) {
  if (!summary.trim()) {
    process.stderr.write('A11yGate produced no summary to comment.\n');
    if (code === 0) code = 1;
  } else {
    try {
      await upsertComment(summary);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Could not post the pull request comment.'}\n`);
      if (code === 0) code = 1;
    }
  }
}

process.exit(code);
