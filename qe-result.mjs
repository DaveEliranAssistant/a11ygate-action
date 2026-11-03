import {readFileSync} from 'node:fs';
const packageVersion=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
const runUrl=()=>`https://github.com/${process.env.GITHUB_REPOSITORY||'DaveEliranAssistant/a11ygate-action'}/actions/runs/${process.env.GITHUB_RUN_ID||'0'}`;
export function buildResult(r,detailsMarkdown='',code=0){
 const base={schemaVersion:1,product:'A11yGate',version:packageVersion,verdict:'error',headline:'Product execution failed; inspect native outputs',metrics:[],findings:[],detailsMarkdown:detailsMarkdown.slice(0,100000),runUrl:runUrl()};
 if(!r)return base;
 const counts=r.counts;
 if(!counts||!['new','fixed','stillOpen'].every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0)||typeof r.threshold!=='string')return base;
 const list=value=>Array.isArray(value)?value:[];
 const coverage=r.coverage;
 const unassessed=Number.isSafeInteger(coverage?.unassessedFindings)&&coverage.unassessedFindings>=0?coverage.unassessedFindings:list(r.findings?.unassessed).length;
 const issues=list(coverage?.issues);
 const scope=list(coverage?.unassessedScope);
 const manualChecks=list(r.manualChecks);
 const gaps=coverage?.status==='incomplete';
 // A known gate failure stays a failure, even if coverage is also incomplete.
 // Exit 2 must never promote a native (possibly stale) PASS to shared pass.
 base.verdict=r.verdict==='FAIL'?'fail':r.verdict==='PASS'&&code===0&&!gaps?'pass':'error';
 base.headline=`${counts.new} new, ${counts.fixed} fixed, ${counts.stillOpen} still open; threshold ${r.threshold}. PASS is not accessibility certification.`;
 if(coverage||r.verdict==='INCOMPLETE')base.headline+=` Coverage: ${coverage?.status||'incomplete'}; ${issues.length} issues, ${unassessed} unassessed findings, ${scope.length} unassessed scope; ${manualChecks.length} manual checks.`;
 if(base.verdict==='error')base.headline='Product execution incomplete or failed. '+base.headline;
 const metrics={new:counts.new,fixed:counts.fixed,'still-open':counts.stillOpen,threshold:r.threshold,unassessed,'manual-checks':manualChecks.length};
 if(coverage){
  metrics.coverage=typeof coverage.status==='string'?coverage.status:'unknown';
  metrics['coverage-issues']=issues.length;
  metrics['unassessed-scope']=scope.length;
 }
 base.metrics=Object.entries(metrics).map(([label,value])=>({label,value}));
 base.findings=[...list(r.findings?.new).map(f=>({...f,group:'new'})),...list(r.findings?.fixed).map(f=>({...f,group:'fixed'})),...list(r.findings?.stillOpen).map(f=>({...f,group:'still-open'}))].slice(0,100).map(f=>({change:f.group,severity:f.impact||'info',title:`${f.group}: ${f.help||f.ruleId}`,location:`${f.path||'/'} ${f.selector||'(document)'}`,...(f.helpUrl?{url:f.helpUrl}:{})}));
 // Keep native coverage/debt evidence inside the existing v1 details field,
 // rather than adding unsupported top-level keys or change classifications.
 if(coverage||manualChecks.length||list(r.findings?.unassessed).length){
  const evidence=JSON.stringify({coverage,unassessedFindings:list(r.findings?.unassessed),manualChecks},null,2);
  const appendix=`\n\nCoverage and manual evidence (native):\n\n\`\`\`json\n${evidence}\n\`\`\`\n`.slice(0,50000);
  base.detailsMarkdown=detailsMarkdown.slice(0,100000-appendix.length)+appendix;
 }
 return base;
}
