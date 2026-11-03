const runUrl=()=>`https://github.com/${process.env.GITHUB_REPOSITORY||'DaveEliranAssistant/a11ygate-action'}/actions/runs/${process.env.GITHUB_RUN_ID||'0'}`;
export function buildResult(r,detailsMarkdown='',code=0){
 const base={schemaVersion:1,product:'A11yGate',version:'0.1.0',verdict:'error',headline:'Product execution failed; inspect native outputs',metrics:[],findings:[],detailsMarkdown:detailsMarkdown.slice(0,100000),runUrl:runUrl()};
 if(!r||code===2)return base;
 base.version=String(r.version||'0.0.0');base.verdict=r.verdict==='PASS'?'pass':r.verdict==='FAIL'?'fail':'error';
 base.headline=`${r.counts.new} new, ${r.counts.fixed} fixed, ${r.counts.stillOpen} still open; threshold ${r.threshold}. PASS is not accessibility certification.`;
 base.metrics=Object.entries({new:r.counts.new,fixed:r.counts.fixed,'still-open':r.counts.stillOpen,threshold:r.threshold}).map(([label,value])=>({label,value}));
 base.findings=[...(r.findings.new||[]).map(f=>({...f,group:'new'})),...(r.findings.stillOpen||[]).map(f=>({...f,group:'still-open'})),...(r.findings.fixed||[]).map(f=>({...f,group:'fixed'}))].slice(0,100).map(f=>({severity:f.impact||'info',title:`${f.group}: ${f.help||f.ruleId}`,location:`${f.path||'/'} ${f.selector||'(document)'}`,...(f.helpUrl?{url:f.helpUrl}:{})}));
 return base;
}
