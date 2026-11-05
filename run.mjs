import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync, realpathSync, statSync, lstatSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
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

function findOwnComment(comments) {
  return findA11yComment(comments.filter((comment) =>
    comment?.user?.type === 'Bot' && comment.user.login === 'github-actions[bot]'));
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
    if (findOwnComment(comments) || batch.length < 100) break;
  }
  return comments;
}

function commentContext() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return { status: 'skipped' };
  try {
    const limit = 1024 * 1024;
    const fd = openSync(process.env.GITHUB_EVENT_PATH, 'r');
    let event;
    try {
      const buffer = Buffer.alloc(limit + 1);
      let size = 0;
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size > limit) return { status: 'skipped' };
      event = JSON.parse(buffer.subarray(0, size).toString('utf8'));
    } finally {
      closeSync(fd);
    }
    const repo = process.env.A11Y_REPOSITORY || '';
    const pr = process.env.A11Y_PR_NUMBER || '';
    const pull = event.pull_request;
    const head = pull?.head?.repo?.full_name;
    const base = pull?.base?.repo?.full_name;
    const validRepo = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
    if (!validRepo(repo) || repo !== process.env.GITHUB_REPOSITORY ||
        !validRepo(head) || base !== repo || !/^[1-9]\d*$/.test(pr) ||
        !Number.isSafeInteger(event.number) || event.number <= 0 ||
        String(event.number) !== pr || pull?.number !== event.number) return { status: 'skipped' };
    if (head !== base || pull.head.repo.fork === true) return { status: 'skipped-fork' };
    return { status: 'ready', repo, pr };
  } catch {
    return { status: 'skipped' };
  }
}

async function upsertComment(markdown, { repo, pr }) {
  const token = process.env.A11Y_TOKEN || '';
  if (!token) {
    throw new Error('A job token is required to post the pull request comment.');
  }
  const api = apiOrigin();
  const body = buildCommentBody(markdown);
  const existing = findOwnComment(await listComments({ api, repo, pr, token }));
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

// Resolve existing ancestors as well as files: outputs may not exist yet.
function canonicalPath(file) {
  const absolute = path.resolve(file);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { if (lstatSync(absolute).isSymbolicLink()) throw new Error('Dangling symlink paths are unsupported'); } catch (entryError) { if (entryError.code !== 'ENOENT') throw entryError; }
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(canonicalPath(parent), path.basename(absolute));
  }
}

function fileIdentity(file) {
  const canonical = canonicalPath(file);
  let inode = null;
  try {
    const stat = statSync(file, { bigint: true });
    inode = `${stat.dev}:${stat.ino}`;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { file, canonical, inode };
}

function rejectAliases(paths, qePath) {
  const update = (process.env.A11Y_UPDATE_BASELINE || '').trim();
  const outputs = [paths.markdown, paths.json, qePath];
  if (update) {
    outputs.push(update);
    // Guard both appended and extension-replaced review sidecar names.
    outputs.push(...new Set([
      `${update}.review.json`,
      path.join(path.dirname(update), `${path.basename(update, path.extname(update))}.review.json`),
    ]));
  }
  for (const file of [process.env.GITHUB_OUTPUT, process.env.GITHUB_STEP_SUMMARY]) {
    if (file) outputs.push(file);
  }
  const inputs = [
    ...splitPaths(process.env.A11Y_CURRENT),
    ...splitPaths(process.env.A11Y_BASELINE),
    (process.env.A11Y_MANUAL_EVIDENCE || '').trim(),
    process.env.GITHUB_EVENT_PATH,
  ].filter(Boolean).map(fileIdentity);
  const seen = [];
  const aliases = (a, b) => a.canonical === b.canonical || (a.inode !== null && a.inode === b.inode);
  for (const output of outputs.map(fileIdentity)) {
    const conflict = [...inputs, ...seen].find((other) => aliases(output, other));
    if (conflict) throw new Error(`Output path aliases another output or input: ${output.file} and ${conflict.file}`);
    seen.push(output);
  }
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
  const manualEvidence = (process.env.A11Y_MANUAL_EVIDENCE || '').trim();
  if (manualEvidence) args.push('--manual-evidence', manualEvidence);
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
    setOutput('unassessed', report.coverage?.unassessedFindings ?? report.findings?.unassessed?.length ?? 0);
    setOutput('coverage', report.coverage?.status ?? '');
    setOutput('coverage-issues', report.coverage?.issues?.length ?? 0);
    setOutput('unassessed-scope', report.coverage?.unassessedScope?.length ?? 0);
    setOutput('manual-checks', report.manualChecks?.length ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not read the JSON result';
    process.stderr.write(`A11yGate could not read the JSON result: ${message}\n`);
  }
}

const paths = outputPaths();
const qePath=(process.env.A11Y_QE_RESULT||'').trim()||path.join(path.dirname(paths.json),'qe-result-a11ygate.json');
try {
  rejectAliases(paths, qePath);
  // No input or output is touched until every collision check has passed.
  for (const file of [paths.markdown, paths.json]) {
    try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
} catch (error) {
  process.stderr.write(`A11yGate refused unsafe output paths: ${error.message}\n`);
  process.exit(2);
}
const exitCode = runCli(paths.markdown, paths.json);
let native = null;
try {
  if (existsSync(paths.json)) {
    native = JSON.parse(readFileSync(paths.json, 'utf8'));
    native.projectName = targetLabel;
    writeFileSync(paths.json, JSON.stringify(native, null, 2) + '\n');
  }
} catch (error) {
  process.stderr.write(`A11yGate could not read the native report: ${error.message}\n`);
}
if(existsSync(paths.markdown))writeFileSync(paths.markdown,readFileSync(paths.markdown,'utf8').replace(/^# A11yGate .*$/m,'# A11yGate — '+safeLabel));
const summary = readSummary(paths.markdown, '');
writeSummary(summary);
writeResultOutputs(paths.json, exitCode);
writeFileSync(qePath,JSON.stringify(buildResult(native,summary,exitCode),null,2)+'\n');

let code = exitCode;
const context = commentContext();
let commentStatus = context.status === 'skipped-fork' ? 'skipped-fork' : 'skipped';
if (isYes(process.env.A11Y_COMMENT) && context.status === 'ready') {
  try {
    if (!summary.trim()) throw new Error('A11yGate produced no summary to comment.');
    await upsertComment(summary, context);
    commentStatus = 'posted';
  } catch (error) {
    commentStatus = 'error';
    process.stderr.write(`${error instanceof Error ? error.message : 'Could not post the pull request comment.'}\n`);
    if (code === 0) code = 1;
  }
}
setOutput('comment-status', commentStatus);

process.exit(code);
