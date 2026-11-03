#!/usr/bin/env node

// packages/cli/src/run.ts
import { readFile, realpath, stat, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// lib/types.ts
function isImpact(value) {
  return value === "minor" || value === "moderate" || value === "serious" || value === "critical";
}

// packages/cli/src/args.ts
var VALUE_FLAGS = {
  "--current": "current",
  "-c": "current",
  "--baseline": "baseline",
  "-b": "baseline",
  "--threshold": "threshold",
  "-t": "threshold",
  "--markdown": "markdown",
  "-m": "markdown",
  "--json": "json",
  "-j": "json",
  "--update-baseline": "updateBaseline",
  "--manual-evidence": "manualEvidence"
};
function flagName(token) {
  const eq = token.indexOf("=");
  if (eq === -1) return { name: token };
  return { name: token.slice(0, eq), inline: token.slice(eq + 1) };
}
function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return {
      ok: true,
      options: {
        help: true,
        version: false,
        current: [],
        baseline: [],
        threshold: "serious"
      }
    };
  }
  const current = [];
  const baseline = [];
  let threshold = "serious";
  let markdown;
  let json;
  let updateBaseline;
  let manualEvidence;
  let help = false;
  let version = false;
  let thresholdText;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      return { ok: false, error: "Unexpected extra arguments." };
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--version") {
      version = true;
      continue;
    }
    const { name, inline } = flagName(token);
    const field = VALUE_FLAGS[name];
    if (!field) {
      if (token.startsWith("-")) return { ok: false, error: `Unknown option ${token}.` };
      return { ok: false, error: `Unexpected argument ${token}.` };
    }
    const value = inline !== void 0 ? inline : argv[index + 1];
    if (inline === void 0) index += 1;
    if (value === void 0 || value.length === 0) {
      return { ok: false, error: `${name} needs a value.` };
    }
    const jsonFlag = name === "--json" || name === "-j";
    if (value.startsWith("-") && !(jsonFlag && value === "-")) {
      return { ok: false, error: `${name} needs a value.` };
    }
    if (field === "current") current.push(value);
    else if (field === "baseline") baseline.push(value);
    else if (field === "threshold") thresholdText = value;
    else if (field === "markdown") markdown = value;
    else if (field === "json") json = value;
    else if (field === "updateBaseline") updateBaseline = value;
    else manualEvidence = value;
  }
  if (!help && !version && thresholdText !== void 0) {
    if (!isImpact(thresholdText)) {
      return {
        ok: false,
        error: `Unknown impact threshold "${thresholdText}". Use minor, moderate, serious, or critical.`
      };
    }
    threshold = thresholdText;
  }
  return {
    ok: true,
    options: { help, version: version && !help, current, baseline, threshold, markdown, json, updateBaseline, manualEvidence }
  };
}

// packages/cli/src/help.ts
function helpText() {
  return `a11ygate \u2014 accessibility regression gate for axe-core JSON

Usage:
  a11ygate --current <file> [--current <file>] [--baseline <file>] [options]

Options:
  -c, --current <file>         Current axe-core JSON. Repeat for more than one file.
                               Each file is one result, an array of results, or { "results": ... }.
  -b, --baseline <file>        Baseline axe-core JSON. Repeatable. Omit to treat every current finding as new.
  -t, --threshold <impact>     minor, moderate, serious, or critical. Default: serious.
                               Exit 1 only when a new finding is at or above this impact.
  -m, --markdown <file>        Also write the Markdown summary to this file. It is always printed.
  -j, --json <file>            Write the JSON result to this file. Use - to print JSON instead of Markdown.
      --update-baseline <file> Write a proposed baseline and <file>.review.json with exact accepted findings.
      --manual-evidence <file> Import schemaVersion 1 human evidence separately from automated checks.
  -h, --help                   Show this help.
      --version                Show the version.

Exit codes:
  0  No detected new finding is at or above the threshold; existing debt/unassessed scope remain.
  1  At least one new finding is at or above the threshold.
  2  Incomplete scan coverage, unsafe outputs, invalid evidence, or unreadable arguments/JSON.

Examples:
  npx @qe-atlas/a11ygate --current axe.json --baseline a11y/baseline.json
  npx @qe-atlas/a11ygate --current home.json --current cart.json --threshold critical --json result.json
  npx @qe-atlas/a11ygate --current axe.json --update-baseline a11y/baseline.json

A file larger than 8 MB is refused. The same diff and gate as the web app are used.
This source build is unreleased; published 0.1.0 does not include these coverage/manual features.
PASS is not legal advice or certification. Baseline updates never clear the current gate result.
`;
}

// lib/export-baseline.ts
function baselineReview(results, diff) {
  return { schemaVersion: 1, approval: "review-required", acceptedFindings: [...diff.newFindings, ...diff.stillOpen], newlyAccepted: diff.newFindings, retained: diff.stillOpen, noLongerObserved: diff.fixedFindings, unassessed: diff.unassessed ?? [], pages: results.map((r) => r.url), coverage: diff.coverage, warning: "This proposal accepts the listed current findings as existing debt, not resolved issues. Review and commit separately; no approval or certification is implied." };
}
function baselineDocument(results) {
  return `${JSON.stringify(results, null, 2)}
`;
}

// lib/guidance.ts
var rules = {
  "color-contrast": { userImpact: "People with low vision or color-vision differences may not be able to read the affected content.", remediation: "Adjust foreground/background colors to meet the applicable contrast ratio; include hover, focus and disabled states where relevant.", verification: ["Re-run axe on the same page/state and affected selector.", "Measure rendered contrast (normally 4.5:1 text or 3:1 large text); review gradients and dynamic states manually."] },
  "image-alt": { userImpact: "People using screen readers may miss the purpose or information conveyed by the image.", remediation: "Provide contextual alternative text for informative images; use empty alt for genuinely decorative images.", verification: ["Re-run axe on the same page/state and selector.", "Listen with a screen reader and confirm the alternative conveys the same purpose without redundant detail."] },
  "button-name": { userImpact: "Screen-reader and voice-control users may not know the purpose of this button.", remediation: "Give the button a clear accessible name matching its visible purpose; prefer visible text.", verification: ["Inspect its computed accessible name and re-run axe.", "Operate it by keyboard and verify the announced name and resulting state with assistive technology."] },
  "label": { userImpact: "People using assistive technology may not know what input is expected.", remediation: "Associate a visible label with the control and expose instructions/errors programmatically.", verification: ["Inspect the accessible name and label association; re-run axe.", "Navigate and complete the field using keyboard and a screen reader, including validation errors."] }
};
function findingGuidance(f) {
  return { ...rules[f.ruleId] ?? { userImpact: `The affected element may prevent people using assistive technology from perceiving or operating the content (${f.ruleId}); assess the actual user journey.`, remediation: f.help + " Consult the rule guidance and review the actual component; automated advice is not a verified fix.", verification: ["Inspect the affected element and applicable rule guidance.", "Re-run the same rule on the same page/state and manually verify the relevant keyboard/screen-reader journey."] }, source: "Rule-based guidance; contextual human review required, not legal advice or certification." };
}

// lib/limits.ts
var MAX_AXE_JSON_BYTES = 8 * 1024 * 1024;
function axeJsonByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
function axeJsonTooLargeMessage() {
  return "This file is larger than 8 MB. A11yGate reads scans in the browser, so split the results by page or remove the passes, incomplete, and inapplicable arrays before importing.";
}

// lib/manual-evidence.ts
function parseManualEvidence(text) {
  try {
    if (text.length > MAX_AXE_JSON_BYTES || axeJsonByteLength(text) > MAX_AXE_JSON_BYTES) throw Error("Manual evidence exceeds 8 MB.");
    const v = JSON.parse(text);
    if (!v || v.schemaVersion !== 1 || !Array.isArray(v.checks) || v.checks.length > 200) throw Error("Expected schemaVersion 1 and at most 200 checks.");
    const ids = /* @__PURE__ */ new Set();
    const checks = [];
    for (const x of v.checks) {
      if (!x || typeof x !== "object" || Array.isArray(x)) throw Error("Every manual check must be an object.");
      for (const [key, max] of Object.entries({ id: 120, scope: 1024, check: 256, reviewer: 120, date: 10, notes: 4e3 })) {
        if (typeof x[key] !== "string" || !x[key].trim() || x[key].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x[key])) throw Error("Manual check " + key + " is missing, too long or invalid.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !Number.isFinite(Date.parse(x.date)) || new Date(x.date).toISOString().slice(0, 10) !== x.date) throw Error("Manual date must be a real ISO YYYY-MM-DD date.");
      if (!["passed", "failed", "not-assessed"].includes(x.status)) throw Error("Manual status must be passed, failed or not-assessed.");
      if (ids.has(x.id)) throw Error("Manual check IDs must be unique.");
      ids.add(x.id);
      checks.push({ id: x.id, scope: x.scope, check: x.check, reviewer: x.reviewer, date: x.date, status: x.status, notes: x.notes });
    }
    return { ok: true, checks };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid manual evidence." };
  }
}

// lib/copy.ts
var DISCLAIMER = "Automated checks cover only part of WCAG; this is evidence, not certification.";
var LEGAL_DISCLAIMER = "Informational only. Not legal advice. Not a certification of EAA compliance.";

// lib/mapping.ts
var SEEDS = [
  { number: "1.1.1", name: "Non-text Content", level: "A", wcag: "2.1" },
  { number: "1.2.1", name: "Audio-only and Video-only (Prerecorded)", level: "A", wcag: "2.1" },
  { number: "1.2.2", name: "Captions (Prerecorded)", level: "A", wcag: "2.1" },
  {
    number: "1.2.3",
    name: "Audio Description or Media Alternative (Prerecorded)",
    level: "A",
    wcag: "2.1"
  },
  { number: "1.2.4", name: "Captions (Live)", level: "AA", wcag: "2.1" },
  { number: "1.2.5", name: "Audio Description (Prerecorded)", level: "AA", wcag: "2.1" },
  { number: "1.3.1", name: "Info and Relationships", level: "A", wcag: "2.1" },
  { number: "1.3.2", name: "Meaningful Sequence", level: "A", wcag: "2.1" },
  { number: "1.3.3", name: "Sensory Characteristics", level: "A", wcag: "2.1" },
  { number: "1.3.4", name: "Orientation", level: "AA", wcag: "2.1" },
  { number: "1.3.5", name: "Identify Input Purpose", level: "AA", wcag: "2.1" },
  { number: "1.4.1", name: "Use of Color", level: "A", wcag: "2.1" },
  { number: "1.4.2", name: "Audio Control", level: "A", wcag: "2.1" },
  { number: "1.4.3", name: "Contrast (Minimum)", level: "AA", wcag: "2.1" },
  { number: "1.4.4", name: "Resize Text", level: "AA", wcag: "2.1" },
  { number: "1.4.5", name: "Images of Text", level: "AA", wcag: "2.1" },
  { number: "1.4.10", name: "Reflow", level: "AA", wcag: "2.1" },
  { number: "1.4.11", name: "Non-text Contrast", level: "AA", wcag: "2.1" },
  { number: "1.4.12", name: "Text Spacing", level: "AA", wcag: "2.1" },
  { number: "1.4.13", name: "Content on Hover or Focus", level: "AA", wcag: "2.1" },
  { number: "2.1.1", name: "Keyboard", level: "A", wcag: "2.1" },
  { number: "2.1.2", name: "No Keyboard Trap", level: "A", wcag: "2.1" },
  { number: "2.1.4", name: "Character Key Shortcuts", level: "A", wcag: "2.1" },
  { number: "2.2.1", name: "Timing Adjustable", level: "A", wcag: "2.1" },
  { number: "2.2.2", name: "Pause, Stop, Hide", level: "A", wcag: "2.1" },
  { number: "2.3.1", name: "Three Flashes or Below Threshold", level: "A", wcag: "2.1" },
  { number: "2.4.1", name: "Bypass Blocks", level: "A", wcag: "2.1" },
  { number: "2.4.2", name: "Page Titled", level: "A", wcag: "2.1" },
  { number: "2.4.3", name: "Focus Order", level: "A", wcag: "2.1" },
  { number: "2.4.4", name: "Link Purpose (In Context)", level: "A", wcag: "2.1" },
  { number: "2.4.5", name: "Multiple Ways", level: "AA", wcag: "2.1" },
  { number: "2.4.6", name: "Headings and Labels", level: "AA", wcag: "2.1" },
  { number: "2.4.7", name: "Focus Visible", level: "AA", wcag: "2.1" },
  { number: "2.4.11", name: "Focus Not Obscured (Minimum)", level: "AA", wcag: "2.2" },
  { number: "2.5.1", name: "Pointer Gestures", level: "A", wcag: "2.1" },
  { number: "2.5.2", name: "Pointer Cancellation", level: "A", wcag: "2.1" },
  { number: "2.5.3", name: "Label in Name", level: "A", wcag: "2.1" },
  { number: "2.5.4", name: "Motion Actuation", level: "A", wcag: "2.1" },
  { number: "2.5.7", name: "Dragging Movements", level: "AA", wcag: "2.2" },
  { number: "2.5.8", name: "Target Size (Minimum)", level: "AA", wcag: "2.2" },
  { number: "3.1.1", name: "Language of Page", level: "A", wcag: "2.1" },
  { number: "3.1.2", name: "Language of Parts", level: "AA", wcag: "2.1" },
  { number: "3.2.1", name: "On Focus", level: "A", wcag: "2.1" },
  { number: "3.2.2", name: "On Input", level: "A", wcag: "2.1" },
  { number: "3.2.3", name: "Consistent Navigation", level: "AA", wcag: "2.1" },
  { number: "3.2.4", name: "Consistent Identification", level: "AA", wcag: "2.1" },
  { number: "3.2.6", name: "Consistent Help", level: "A", wcag: "2.2" },
  { number: "3.3.1", name: "Error Identification", level: "A", wcag: "2.1" },
  { number: "3.3.2", name: "Labels or Instructions", level: "A", wcag: "2.1" },
  { number: "3.3.3", name: "Error Suggestion", level: "AA", wcag: "2.1" },
  { number: "3.3.4", name: "Error Prevention (Legal, Financial, Data)", level: "AA", wcag: "2.1" },
  { number: "3.3.7", name: "Redundant Entry", level: "A", wcag: "2.2" },
  { number: "3.3.8", name: "Accessible Authentication (Minimum)", level: "AA", wcag: "2.2" },
  // 4.1.1 Parsing was removed in WCAG 2.2. Kept for axe tags on WCAG 2.1 targets.
  { number: "4.1.1", name: "Parsing", level: "A", wcag: "2.1" },
  { number: "4.1.2", name: "Name, Role, Value", level: "A", wcag: "2.1" },
  { number: "4.1.3", name: "Status Messages", level: "AA", wcag: "2.1" }
];
function tagFor(number) {
  return `wcag${number.split(".").join("")}`;
}
var CRITERIA = SEEDS.map((seed) => ({
  tag: tagFor(seed.number),
  number: seed.number,
  name: seed.name,
  level: seed.level,
  en301549: `9.${seed.number}`,
  wcag: seed.wcag
}));
var BY_TAG = new Map(CRITERIA.map((criterion) => [criterion.tag, criterion]));
function getCriterion(tag) {
  return BY_TAG.get(tag.toLowerCase()) ?? null;
}
function lookupStandards(tags) {
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tag of tags) {
    const criterion = getCriterion(tag);
    if (!criterion || seen.has(criterion.number)) continue;
    seen.add(criterion.number);
    hits.push({ kind: "criterion", ...criterion });
  }
  if (hits.length === 0) return [{ kind: "best-practice" }];
  return hits;
}
function formatStandards(tags) {
  const hits = lookupStandards(tags);
  if (hits.length === 1 && hits[0]?.kind === "best-practice") return "best practice";
  return hits.filter((hit) => hit.kind === "criterion").map(
    (hit) => `WCAG ${hit.wcag} ${hit.number} ${hit.name} (${hit.level}); EN 301 549 ${hit.en301549}`
  ).join(" | ");
}

// lib/export-markdown.ts
function cell(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_\[\]()!|]/g, "\\$&").replace(/[\r\n]/g, " ");
}
function findingLine(finding) {
  const selector = finding.selector.replace(/`/g, "'");
  const impact = finding.impact ?? "unspecified";
  const guidance = findingGuidance(finding);
  return `- **${cell(finding.ruleId)}** (${impact}) on \`${cell(finding.url)}\` \u2014 \`${cell(selector)}\` \u2014 ${cell(finding.help)} \u2014 ${cell(formatStandards(finding.tags))}
  - Affected element: \`${cell(finding.html)}\`; fingerprint: \`${cell(finding.fingerprint)}\`.
  - User impact: ${cell(guidance.userImpact)}
  - Remediation: ${cell(guidance.remediation)}
  - Verification: ${guidance.verification.map(cell).join(" ")}${finding.assessmentReason ? "\n  - Assessment: " + cell(finding.assessmentReason) : ""}`;
}
function section(title, findings) {
  if (findings.length === 0) return [`## ${title}`, "", "None.", ""];
  return [`## ${title}`, "", ...findings.map(findingLine), ""];
}
function prSummaryMarkdown(input) {
  const lines = [
    `# A11yGate \u2014 ${cell(input.projectName)}`,
    ...input.synthetic ? ["SYNTHETIC evidence \u2014 not a real audit or customer assessment."] : [],
    "",
    `**Verdict: ${input.verdict}** (impact threshold: ${input.threshold})`,
    "",
    input.reason,
    "",
    "| Status | Count |",
    "| --- | --- |",
    `| New | ${input.diff.newFindings.length} |`,
    `| Fixed | ${input.diff.fixedFindings.length} |`,
    `| Still open | ${input.diff.stillOpen.length} |`,
    "",
    `Generated: ${input.generatedAt}`,
    "",
    "## Scan coverage and existing debt",
    "",
    `Coverage: ${input.diff.coverage?.status ?? "unverified"}. Existing debt: ${input.diff.stillOpen.length}; previously reported findings now unassessed: ${input.diff.unassessed?.length ?? 0}. PASS means no detected new threshold violation, not an accessible or certified service.`,
    ...(input.diff.coverage?.issues ?? []).map((i) => `- ${i.code === "missing-page" ? "Missing page" : cell(i.code)}: ${cell(i.page)} \u2014 ${cell(i.detail)}`),
    "",
    "### Unassessed scope",
    ...(input.diff.coverage?.unassessedScope ?? ["Scan coverage was not supplied."]).map((x) => "- " + cell(x)),
    "",
    ...section("New", input.diff.newFindings),
    ...section("Fixed", input.diff.fixedFindings),
    ...section("Still open", input.diff.stillOpen),
    ...section("Unassessed \u2014 not verified fixed", input.diff.unassessed ?? []),
    "## Manual evidence \u2014 separate from automated checks",
    "Self-reported, editable human assertions. Reviewer identity and freshness are not verified. These records do not improve the automated gate; absent evidence is unassessed.",
    ...input.manualChecks?.length ? input.manualChecks.map((c) => `- ${cell(c.id)}: ${cell(c.check)}; scope ${cell(c.scope)}; reviewer ${cell(c.reviewer)}; date ${cell(c.date)}; status **${c.status}**; notes ${cell(c.notes)}`) : ["No manual evidence recorded."],
    "",
    DISCLAIMER,
    LEGAL_DISCLAIMER,
    ""
  ];
  return lines.join("\n");
}

// lib/diff.ts
function byLocation(a, b) {
  return a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector);
}
function indexByFingerprint(findings) {
  const indexed = /* @__PURE__ */ new Map();
  for (const finding of findings) {
    if (!indexed.has(finding.fingerprint)) indexed.set(finding.fingerprint, finding);
  }
  return indexed;
}
function diffScans(current, baseline) {
  const base = indexByFingerprint(baseline ?? []);
  const next = indexByFingerprint(current);
  const newFindings = [];
  const stillOpen = [];
  for (const finding of next.values()) {
    if (base.has(finding.fingerprint)) {
      stillOpen.push({ ...finding, status: "still-open" });
    } else {
      newFindings.push({ ...finding, status: "new" });
    }
  }
  const fixedFindings = [];
  for (const finding of base.values()) {
    if (!next.has(finding.fingerprint)) {
      fixedFindings.push({ ...finding, status: "fixed" });
    }
  }
  newFindings.sort(byLocation);
  fixedFindings.sort(byLocation);
  stillOpen.sort(byLocation);
  const statusOrder = { new: 0, fixed: 1, "still-open": 2, unassessed: 3 };
  const all = [...newFindings, ...fixedFindings, ...stillOpen].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || byLocation(a, b)
  );
  return { newFindings, fixedFindings, stillOpen, all };
}

// lib/fingerprint.ts
function unescapeCss(value) {
  return value.replace(/\\(.)/g, "$1");
}
function isDynamicId(id) {
  const value = id.trim();
  if (value.length === 0) return false;
  if (/^:r[0-9a-z]+:?$/i.test(value)) return true;
  if (/^ember\d+$/i.test(value)) return true;
  if (/^(?:react|mui|headlessui|radix)-/i.test(value) && /\d/.test(value)) return true;
  if (/(?:^|[-_])[a-f0-9]{6,}(?:$|[-_])/i.test(value) && /\d/.test(value) && /[a-f]/i.test(value)) {
    return true;
  }
  if (/[-_]\d{4,}$/.test(value) || /^\d{4,}$/.test(value)) return true;
  return false;
}
function stripDynamicIds(selector) {
  const withoutAttributes = selector.replace(
    /\[id=(?:'([^']*)'|"([^"]*)"|([^\]]+))\]/gi,
    (match, single, double, bare) => {
      const id = unescapeCss(single ?? double ?? bare ?? "");
      return isDynamicId(id) ? "" : match;
    }
  );
  return withoutAttributes.replace(/#(?:\\.|[^\s#.\[>,+~])+/g, (match) => {
    const id = unescapeCss(match.slice(1));
    return isDynamicId(id) ? "" : match;
  });
}
function stripHashClasses(selector) {
  return selector.replace(/\.css-[a-z0-9]+\b/gi, "").replace(/\.([A-Za-z_][\w-]*?)__[A-Za-z0-9]{5,}\b/g, ".$1");
}
function tidySelector(selector) {
  let current = selector.replace(/\s+/g, " ").trim();
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/\s*>\s*>\s*/g, " > ").replace(/\s*\+\s*\+\s*/g, " + ").replace(/^\s*[>+~]\s*/, "").replace(/\s*[>+~]\s*$/, "").replace(/\s+/g, " ").trim();
  }
  return current;
}
function normaliseSelector(selector) {
  const withoutIndexes = selector.trim().replace(/:nth-(?:last-)?(?:child|of-type)\([^)]*\)/gi, "");
  return tidySelector(stripHashClasses(stripDynamicIds(withoutIndexes)));
}
function pagePath(url) {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    let path2 = parsed.pathname || "/";
    if (path2.length > 1 && path2.endsWith("/")) path2 = path2.slice(0, -1);
    return path2 || "/";
  } catch {
    const withoutQuery = trimmed.split(/[?#]/)[0] ?? "";
    if (withoutQuery.length === 0) return "/";
    let path2 = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
    if (path2.length > 1 && path2.endsWith("/")) path2 = path2.slice(0, -1);
    return path2;
  }
}
function fingerprint(ruleId, selector, url) {
  return `${ruleId}|${normaliseSelector(selector)}|${pagePath(url)}`;
}

// lib/gate.ts
var RANK = {
  minor: 1,
  moderate: 2,
  serious: 3,
  critical: 4
};
function impactRank(impact) {
  if (!impact) return 0;
  return RANK[impact];
}
function meetsThreshold(impact, threshold) {
  return impactRank(impact) >= impactRank(threshold);
}
function gatingFindings(findings, threshold) {
  return findings.filter((finding) => meetsThreshold(finding.impact, threshold));
}
function gateVerdict(newFindings, threshold, coverage) {
  if (gatingFindings(newFindings, threshold).length > 0) return "FAIL";
  return coverage?.status === "incomplete" ? "INCOMPLETE" : "PASS";
}
function verdictReason(newFindings, threshold) {
  const gating = gatingFindings(newFindings, threshold);
  if (gating.length === 0) {
    return `No new finding is at or above ${threshold}.`;
  }
  const rules2 = [...new Set(gating.map((finding) => finding.ruleId))];
  const noun = gating.length === 1 ? "finding" : "findings";
  return `${gating.length} new ${noun} at or above ${threshold}: ${rules2.join(", ")}.`;
}

// lib/parse.ts
var ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function isIsoTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  const calendar = /* @__PURE__ */ new Date(day + "T00:00:00Z");
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stripBom(text) {
  return text.replace(/^\uFEFF/, "").trim();
}
function readImpact(value, path2) {
  if (value === null || isImpact(value)) return { ok: true, impact: value };
  return {
    ok: false,
    error: `${path2} must be minor, moderate, serious, critical, or null`
  };
}
function readTarget(value, path2) {
  if (!Array.isArray(value) || value.length === 0) {
    return `${path2}.target must be an array of strings`;
  }
  const flat = [];
  for (const part of value) {
    if (typeof part === "string") {
      if (part.trim().length === 0) return `${path2}.target must be an array of strings`;
      flat.push(part);
      continue;
    }
    if (Array.isArray(part) && part.length > 0 && part.every((item) => typeof item === "string" && item.trim().length > 0)) {
      flat.push(part.join(" "));
      continue;
    }
    return `${path2}.target must be an array of strings`;
  }
  return flat;
}
function validateNode(value, path2) {
  if (!isRecord(value)) return `${path2} must be an object`;
  const target = readTarget(value.target, path2);
  if (typeof target === "string") return target;
  if (typeof value.html !== "string") return `${path2}.html must be a string`;
  const node = {
    target,
    html: value.html
  };
  if (Object.prototype.hasOwnProperty.call(value, "impact")) {
    const impact = readImpact(value.impact, `${path2}.impact`);
    if (!impact.ok) return impact.error;
    node.impact = impact.impact;
  }
  return node;
}
function validateViolation(value, path2) {
  if (!isRecord(value)) return `${path2} must be an object`;
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    return `${path2}.id must be a non-empty string`;
  }
  if (!Object.prototype.hasOwnProperty.call(value, "impact")) {
    return `${path2}.impact is missing`;
  }
  const impact = readImpact(value.impact, `${path2}.impact`);
  if (!impact.ok) return impact.error;
  if (!Array.isArray(value.tags)) return `${path2}.tags must be an array of strings`;
  if (!value.tags.every((tag) => typeof tag === "string")) {
    return `${path2}.tags must be an array of strings`;
  }
  if (typeof value.help !== "string" || value.help.trim().length === 0) {
    return `${path2}.help must be a non-empty string`;
  }
  if (typeof value.helpUrl !== "string" || value.helpUrl.trim().length === 0) {
    return `${path2}.helpUrl must be a non-empty string`;
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    return `${path2}.nodes must contain at least one node`;
  }
  const nodes = [];
  for (let index = 0; index < value.nodes.length; index += 1) {
    const node = validateNode(value.nodes[index], `${path2}.nodes[${index}]`);
    if (typeof node === "string") return node;
    nodes.push(node);
  }
  return {
    id: value.id,
    impact: impact.impact,
    tags: value.tags,
    help: value.help,
    helpUrl: value.helpUrl,
    nodes
  };
}
function isSynthetic(value) {
  return typeof value._fixture === "string" && /synthetic/i.test(value._fixture);
}
function validateResult(value, path2) {
  if (!isRecord(value)) return `${path2} must be an axe result object`;
  if (typeof value.url !== "string" || value.url.trim().length === 0) {
    return `${path2}.url must be a non-empty string`;
  }
  if (!isIsoTimestamp(value.timestamp)) {
    return `${path2}.timestamp must be an ISO date string`;
  }
  if (!isRecord(value.testEngine) || typeof value.testEngine.version !== "string" || value.testEngine.version.trim().length === 0) {
    return `${path2}.testEngine.version must be a non-empty string`;
  }
  if (!Array.isArray(value.violations)) return `${path2}.violations must be an array`;
  for (const key of ["toolOptions", "scanConfig", "testEnvironment"]) {
    if (key in value && !isRecord(value[key])) return `${path2}.${key} must be an object`;
  }
  if ("scanStatus" in value && value.scanStatus !== "complete" && value.scanStatus !== "failed") return `${path2}.scanStatus must be complete or failed`;
  if ("scanError" in value && (typeof value.scanError !== "string" || !value.scanError.trim())) return `${path2}.scanError must be a non-empty string`;
  if (value.scanError && value.scanStatus !== "failed") return `${path2}.scanError requires scanStatus failed; contradictory scan success is unsupported`;
  if (value.scanStatus === "failed" && !value.scanError) return `${path2}.scanError is required for failed scans`;
  const incomplete = [];
  if ("incomplete" in value) {
    if (!Array.isArray(value.incomplete)) return `${path2}.incomplete must be an array`;
    for (let i = 0; i < value.incomplete.length; i++) {
      const item = validateViolation(value.incomplete[i], `${path2}.incomplete[${i}]`);
      if (typeof item === "string") return item;
      incomplete.push(item);
    }
  }
  const violations = [];
  for (let index = 0; index < value.violations.length; index += 1) {
    const violation = validateViolation(value.violations[index], `${path2}.violations[${index}]`);
    if (typeof violation === "string") return violation;
    violations.push(violation);
  }
  return {
    synthetic: isSynthetic(value),
    result: {
      url: value.url,
      timestamp: value.timestamp,
      testEngine: { version: value.testEngine.version },
      violations,
      ..."toolOptions" in value ? { toolOptions: value.toolOptions } : {},
      ..."scanConfig" in value ? { scanConfig: value.scanConfig } : {},
      ..."testEnvironment" in value ? { testEnvironment: value.testEnvironment } : {},
      ..."scanStatus" in value ? { scanStatus: value.scanStatus } : {},
      ...typeof value.scanError === "string" ? { scanError: value.scanError } : {},
      ..."incomplete" in value ? { incomplete } : {}
    }
  };
}
function looksLikeAxeResult(value) {
  return Array.isArray(value.violations) || typeof value.url === "string";
}
function unwrapEnvelope(value) {
  if (!isRecord(value) || looksLikeAxeResult(value)) return value;
  if ("results" in value) return value.results;
  return value;
}
function foreignShapeMessage(value) {
  if (looksLikeAxeResult(value)) return null;
  if (Array.isArray(value.issues)) {
    return "This looks like a pa11y report. A11yGate reads axe-core JSON: one result object, or an array of result objects, with url, timestamp, testEngine.version, and violations.";
  }
  if (isRecord(value.audits) || isRecord(value.categories) || typeof value.lighthouseVersion === "string") {
    return "This looks like a Lighthouse report. A11yGate reads axe-core JSON, not a Lighthouse export.";
  }
  return null;
}
function parseAxeJsonInner(text) {
  if (typeof text !== "string") return { ok: false, error: "Not valid JSON." };
  if (text.length > MAX_AXE_JSON_BYTES || axeJsonByteLength(text) > MAX_AXE_JSON_BYTES) {
    return { ok: false, error: axeJsonTooLargeMessage() };
  }
  const source = stripBom(text);
  if (source.length === 0) return { ok: false, error: "The file is empty." };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "could not parse JSON";
    return { ok: false, error: `Not valid JSON: ${detail}` };
  }
  parsed = unwrapEnvelope(parsed);
  if (isRecord(parsed)) {
    const hint = foreignShapeMessage(parsed);
    if (hint) return { ok: false, error: hint };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { ok: false, error: "The array does not contain any axe results." };
    const results = [];
    let synthetic = false;
    for (let index = 0; index < parsed.length; index += 1) {
      const validated2 = validateResult(parsed[index], `results[${index}]`);
      if (typeof validated2 === "string") return { ok: false, error: validated2 };
      results.push(validated2.result);
      synthetic = synthetic || validated2.synthetic;
    }
    return { ok: true, results, synthetic };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Expected an axe result object or an array of axe results." };
  }
  const validated = validateResult(parsed, "result");
  if (typeof validated === "string") return { ok: false, error: validated };
  return { ok: true, results: [validated.result], synthetic: validated.synthetic };
}
function parseAxeJson(text) {
  try {
    return parseAxeJsonInner(text);
  } catch {
    return {
      ok: false,
      error: "Could not read this JSON. Check that it is an axe-core result and try again."
    };
  }
}
function parseAxeDocuments(documents) {
  if (documents.length === 0) return { ok: false, error: "Choose at least one JSON file." };
  const results = [];
  let synthetic = false;
  for (const document of documents) {
    const parsed = parseAxeJson(document.text);
    if (!parsed.ok) return { ok: false, error: `${document.name}: ${parsed.error}` };
    results.push(...parsed.results);
    synthetic = synthetic || parsed.synthetic;
  }
  return { ok: true, results, synthetic };
}
function findingsFromResults(results) {
  const byFingerprint = /* @__PURE__ */ new Map();
  for (const result of results) {
    const path2 = pagePath(result.url);
    for (const violation of result.violations) {
      for (const node of violation.nodes) {
        const selector = node.target.join(" ");
        const resolvedImpact = node.impact !== void 0 ? node.impact : violation.impact;
        const finding = {
          fingerprint: fingerprint(violation.id, selector, result.url),
          ruleId: violation.id,
          impact: resolvedImpact,
          tags: violation.tags,
          help: violation.help,
          helpUrl: violation.helpUrl,
          selector,
          html: node.html,
          url: result.url,
          path: path2,
          engineVersion: result.testEngine.version,
          timestamp: result.timestamp
        };
        const existing = byFingerprint.get(finding.fingerprint);
        if (!existing || impactRank(finding.impact) > impactRank(existing.impact)) {
          byFingerprint.set(finding.fingerprint, finding);
        }
      }
    }
  }
  return [...byFingerprint.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.ruleId.localeCompare(b.ruleId) || a.selector.localeCompare(b.selector)
  );
}

// lib/compare.ts
function scanPageKey(url) {
  try {
    const u = new URL(url);
    return pagePath(url) + u.search + u.hash;
  } catch {
    return url.trim();
  }
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value) ?? "null";
}
function config(result) {
  return canonical({ engine: result.testEngine.version, options: result.toolOptions ?? null, context: result.scanConfig ?? null, environment: result.testEnvironment ?? null });
}
function group(results) {
  const out = /* @__PURE__ */ new Map();
  for (const r of results) {
    const key = scanPageKey(r.url);
    out.set(key, [...out.get(key) ?? [], r]);
  }
  return out;
}
function scopedFindings(results) {
  return results.flatMap((r) => findingsFromResults([r]).map((f) => ({ ...f, fingerprint: scanPageKey(r.url) === f.path ? f.fingerprint : f.fingerprint + "|scope:" + scanPageKey(r.url) })));
}
function compareScans(current, baseline) {
  const next = group(current), base = group(baseline ?? []);
  const coverage = { status: "complete", issues: [], pages: [], unassessedScope: [
    "Only supplied page/query/hash states are assessed; undiscovered pages and interactions are unassessed.",
    "Manual keyboard, screen-reader and usability checks are not performed by the automated gate.",
    "Origins are intentionally ignored for local CI hosts; equivalent environments must be established by the caller.",
    "Normalized selectors are heuristic identities, not proof that every affected element is unchanged."
  ], unassessedFindings: 0 };
  const blocked = /* @__PURE__ */ new Set();
  const issue = (page, code, detail, blocking = true) => {
    coverage.issues.push({ page, code, detail });
    if (blocking) {
      blocked.add(page);
      coverage.status = "incomplete";
    } else if (coverage.status === "complete") coverage.status = "unverified";
  };
  for (const key of /* @__PURE__ */ new Set([...base.keys(), ...next.keys()])) {
    const a = next.get(key) ?? [], b = base.get(key) ?? [];
    if (!a.length) issue(key, "missing-page", "Page was in the baseline but is absent from the current input; previous findings are unassessed, not fixed.");
    if (a.length > 1 || b.length > 1) issue(key, "duplicate-page", "Multiple scans for this page/state are ambiguous; provide distinct query/hash states or separate comparisons.");
    if ([...a, ...b].some((r) => r.scanStatus === "failed" || !!r.scanError)) issue(key, "failed-scan", [...a, ...b].filter((r) => r.scanStatus === "failed").map((r) => r.scanError).join("; "));
    if (a.length === 1 && b.length === 1 && config(a[0]) !== config(b[0])) issue(key, "configuration-changed", "Engine, toolOptions, scanConfig or testEnvironment differs or is missing on one side; absence is not a fix.");
    if ([...a, ...b].some((r) => !r.toolOptions && !r.scanConfig)) issue(key, "configuration-unrecorded", "Rule selection, exclusions, viewport and authentication context were not fully recorded; equivalence is unverified.", false);
    if ([...a].some((r) => (r.incomplete?.length ?? 0) > 0)) issue(key, "axe-needs-review", "axe incomplete results require human review; they are not passes or accepted fixes.", false);
    coverage.pages.push({ page: key, current: a.length, baseline: b.length, comparable: !blocked.has(key) });
  }
  const d = diffScans(scopedFindings(current), baseline === null ? null : scopedFindings(baseline));
  const unassessed = [];
  d.fixedFindings = d.fixedFindings.filter((f) => {
    const key = scanPageKey(f.url);
    const relocated = d.newFindings.some((n) => scanPageKey(n.url) === key && n.ruleId === f.ruleId);
    const incomplete = next.get(key)?.some((r) => r.incomplete?.some((v) => v.id === f.ruleId));
    const reason = blocked.has(key) ? "Scan coverage is missing, failed or materially incomparable." : relocated ? "A selector changed or another occurrence was found; resolution is unverified." : incomplete ? "axe reported this rule as incomplete; manual review is needed." : null;
    if (reason) {
      unassessed.push({ ...f, status: "unassessed", assessmentReason: reason });
      return false;
    }
    return true;
  });
  coverage.unassessedFindings = unassessed.length;
  return { ...d, unassessed, coverage, all: [...d.newFindings, ...d.fixedFindings, ...d.stillOpen, ...unassessed] };
}

// lib/project.ts
function inferProjectName(results) {
  const hosts = /* @__PURE__ */ new Set();
  for (const result of results) {
    try {
      hosts.add(new URL(result.url).host);
    } catch {
      hosts.add(result.url);
    }
  }
  if (hosts.size === 1) {
    const host = [...hosts][0];
    if (host) return host;
  }
  return "Imported scan";
}

// packages/cli/src/run.ts
function resolveInput(cwd, file) {
  return path.resolve(cwd, file);
}
async function readDocuments(files, cwd) {
  const documents = [];
  for (const file of files) {
    const absolute = resolveInput(cwd, file);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) return { ok: false, error: `${file}: not a file.` };
      if (info.size === 0) return { ok: false, error: `${file}: The file is empty.` };
      if (info.size > MAX_AXE_JSON_BYTES) {
        return { ok: false, error: `${file}: ${axeJsonTooLargeMessage()}` };
      }
      documents.push({ name: file, text: await readFile(absolute, "utf8") });
    } catch (error) {
      const code = error.code;
      if (code === "ENOENT") return { ok: false, error: `${file}: file not found.` };
      return { ok: false, error: `${file}: could not read the file.` };
    }
  }
  return { ok: true, documents };
}
function writeFailure(file, error) {
  const code = error.code;
  if (code === "ENOENT") return `${file}: the directory does not exist.`;
  if (code === "EISDIR") return `${file}: is a directory, not a file.`;
  return `${file}: could not write the file.`;
}
async function readVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "package.json"),
    path.join(here, "..", "..", "packages", "cli", "package.json")
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8"));
      if (parsed.name === "@qe-atlas/a11ygate" && parsed.version) return parsed.version;
    } catch {
    }
  }
  return "0.0.0";
}
function findingJson(finding) {
  return {
    status: finding.status,
    assessmentReason: finding.assessmentReason,
    guidance: findingGuidance(finding),
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    impact: finding.impact,
    path: finding.path,
    url: finding.url,
    selector: finding.selector,
    html: finding.html,
    help: finding.help,
    helpUrl: finding.helpUrl,
    tags: finding.tags
  };
}
function reportJson(input) {
  return `${JSON.stringify(
    {
      tool: "a11ygate",
      schemaVersion: 2,
      releaseStatus: "unreleased-source-build",
      synthetic: input.synthetic,
      version: input.version,
      projectName: input.projectName,
      verdict: input.verdict,
      threshold: input.threshold,
      reason: input.reason,
      generatedAt: input.generatedAt,
      coverage: input.diff.coverage,
      baselineReview: baselineReview(input.currentResults, input.diff),
      manualChecks: input.manualChecks,
      manualEvidenceNotice: "Self-reported human evidence, not identity-verified or automatically assessed; never improves the automated gate. Unrecorded scopes remain unassessed.",
      counts: {
        new: input.diff.newFindings.length,
        fixed: input.diff.fixedFindings.length,
        stillOpen: input.diff.stillOpen.length
      },
      findings: {
        new: input.diff.newFindings.map(findingJson),
        fixed: input.diff.fixedFindings.map(findingJson),
        stillOpen: input.diff.stillOpen.map(findingJson),
        unassessed: (input.diff.unassessed ?? []).map(findingJson)
      }
    },
    null,
    2
  )}
`;
}
async function run(argv, io = {}) {
  const stdout = io.stdout ?? ((chunk) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk) => process.stderr.write(chunk));
  const cwd = io.cwd ?? process.cwd();
  const now = io.now ?? (() => /* @__PURE__ */ new Date());
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr(`${parsed.error}
`);
    stderr("Run a11ygate --help for usage.\n");
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    stdout(helpText());
    return 0;
  }
  if (options.version) {
    stdout(`${await readVersion()}
`);
    return 0;
  }
  if (options.current.length === 0) {
    stderr("Pass at least one current axe JSON file with --current.\n");
    return 2;
  }
  try {
    const identify = async (file) => {
      const absolute = resolveInput(cwd, file);
      const canonical2 = await realpath(absolute).catch(async () => {
        if ((await lstat(absolute).catch(() => null))?.isSymbolicLink()) throw new Error("Dangling symlinks are not safe output/input paths.");
        return path.join(await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute)), path.basename(absolute));
      });
      const info = await stat(absolute).catch(() => null);
      return { canonical: canonical2, inode: info ? `${info.dev}:${info.ino}` : null };
    };
    const inputs = await Promise.all([...options.current, ...options.baseline, ...options.manualEvidence ? [options.manualEvidence] : []].map(identify));
    const baselineProtectedInputs = await Promise.all([...options.current, ...options.manualEvidence ? [options.manualEvidence] : []].map(identify));
    const outputs = [options.markdown, options.json === "-" ? void 0 : options.json, options.updateBaseline, options.updateBaseline ? options.updateBaseline + ".review.json" : void 0].filter((x) => !!x);
    const seen = [];
    for (const output of outputs) {
      const id = await identify(output);
      const same = (x) => x.canonical === id.canonical || !!(id.inode && x.inode === id.inode);
      const protectedInputs = output === options.updateBaseline ? baselineProtectedInputs : inputs;
      if (protectedInputs.some(same) || seen.some(same)) {
        stderr("Output paths must be distinct and must not overwrite input evidence.\n");
        return 2;
      }
      seen.push(id);
    }
  } catch (error) {
    stderr((error instanceof Error ? error.message : "Unsafe output path.") + "\n");
    return 2;
  }
  const currentRead = await readDocuments(options.current, cwd);
  if (!currentRead.ok) {
    stderr(`${currentRead.error}
`);
    return 2;
  }
  const current = parseAxeDocuments(currentRead.documents);
  if (!current.ok) {
    stderr(`${current.error}
`);
    return 2;
  }
  let baselineResults = null;
  let baselineSynthetic = false;
  if (options.baseline.length > 0) {
    const baselineRead = await readDocuments(options.baseline, cwd);
    if (!baselineRead.ok) {
      stderr(`${baselineRead.error}
`);
      return 2;
    }
    const baseline = parseAxeDocuments(baselineRead.documents);
    if (!baseline.ok) {
      stderr(`${baseline.error}
`);
      return 2;
    }
    baselineResults = baseline.results;
    baselineSynthetic = baseline.synthetic;
  }
  if (current.synthetic || baselineSynthetic) {
    stderr("Note: at least one file is marked as a synthetic fixture, not a real audit.\n");
  }
  let manualChecks = [];
  if (options.manualEvidence) {
    const manualRead = await readDocuments([options.manualEvidence], cwd);
    if (!manualRead.ok) {
      stderr(manualRead.error + "\n");
      return 2;
    }
    const manual = parseManualEvidence(manualRead.documents[0].text);
    if (!manual.ok) {
      stderr(manual.error + "\n");
      return 2;
    }
    manualChecks = manual.checks;
  }
  const diff = compareScans(current.results, baselineResults);
  const verdict = gateVerdict(diff.newFindings, options.threshold, diff.coverage);
  const reason = verdict === "INCOMPLETE" ? "Missing, failed or materially incomparable scan coverage prevents a regression PASS." : verdictReason(diff.newFindings, options.threshold);
  const projectName = inferProjectName(current.results);
  const generatedAt = now().toISOString();
  const version = await readVersion();
  const markdown = prSummaryMarkdown({
    projectName,
    verdict,
    threshold: options.threshold,
    diff,
    generatedAt,
    reason,
    manualChecks,
    synthetic: current.synthetic || baselineSynthetic
  });
  const json = reportJson({ version, projectName, verdict, threshold: options.threshold, reason, generatedAt, diff, currentResults: current.results, manualChecks, synthetic: current.synthetic || baselineSynthetic });
  if (options.updateBaseline) {
    if (diff.coverage?.status === "incomplete") {
      stderr("Refusing baseline update: scan coverage is incomplete. Existing baseline is unchanged.\n");
      return 2;
    }
    try {
      await writeFile(resolveInput(cwd, options.updateBaseline + ".review.json"), JSON.stringify(baselineReview(current.results, diff), null, 2) + "\n", "utf8");
      await writeFile(resolveInput(cwd, options.updateBaseline), baselineDocument(current.results), "utf8");
    } catch (error) {
      stderr(`${writeFailure(options.updateBaseline, error)}
`);
      return 2;
    }
    stderr(`Wrote baseline ${options.updateBaseline}
`);
  }
  if (options.markdown) {
    try {
      await writeFile(resolveInput(cwd, options.markdown), markdown, "utf8");
    } catch (error) {
      stderr(`${writeFailure(options.markdown, error)}
`);
      return 2;
    }
  }
  if (options.json && options.json !== "-") {
    try {
      await writeFile(resolveInput(cwd, options.json), json, "utf8");
    } catch (error) {
      stderr(`${writeFailure(options.json, error)}
`);
      return 2;
    }
  }
  stdout(options.json === "-" ? json : markdown);
  return verdict === "FAIL" ? 1 : verdict === "INCOMPLETE" ? 2 : 0;
}

// packages/cli/src/bin.ts
void run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const message = error instanceof Error ? error.message : "A11yGate failed.";
    process.stderr.write(`${message}
`);
    process.exitCode = 2;
  }
);
