const target = { repository: 'Oddmash/example', number: 42 };
const startedAt = '2026-01-01T12:00:00Z';
const updatedAt = '2026-01-01T12:01:00Z';
const job = (role, state, extra = {}) => ({ role, state, target, correlationId: 'fixture-' + role, attempt: 1, startedAt, updatedAt, phase: 'reviewing', ...extra });
const jobs = [
  job('reviewer', 'failed', { finishedAt: updatedAt, failure: 'unexpected', phase: 'validating', phaseHistory: [{ phase: 'collecting-changes', timestamp: startedAt }, { phase: 'validating', timestamp: '2026-01-01T12:00:30Z' }] }),
  job('qa', 'running', { phase: 'specialist-review' }),
  job('docs', 'returned', { finishedAt: updatedAt }),
  job('impact', 'published', { phase: 'publishing', publication: { kind: 'comment', id: 1, at: updatedAt }, finishedAt: updatedAt }),
  job('docs','returned',{target:{repository:target.repository,number:43},correlationId:'fixture-other-target',finishedAt:updatedAt})
];
const snapshot = { connected: true, jobs, settings: null, observedAt: updatedAt };

export const status = snapshot;
export const contributors = {observedAt:updatedAt,partial:false,pulls:[{repository:target.repository, number:43, title:'Improve component accessibility for long localized labels on narrow screens',author:'external-contributor',updatedAt,draft:false,evidence:{observedAt:updatedAt,reviewsComplete:true,reviews:[{role:'reviewer',state:'APPROVED',currentHead:true,submittedAt:updatedAt,id:91}],workflow:{state:'action-required',id:71}}},{repository:target.repository,number:45,title:'Workflow rerun in progress',author:'guest',updatedAt,draft:false,evidence:{observedAt:updatedAt,reviewsComplete:true,reviews:[{role:'reviewer',state:'APPROVED',currentHead:true,submittedAt:updatedAt,id:92}],workflow:{state:'running',id:72,attempt:2,name:'CI'}}},{repository:target.repository,number:46,title:'Failed browser tests',author:'guest',updatedAt,draft:false,evidence:{observedAt:updatedAt,reviewsComplete:true,reviews:[],reviewStatus:{state:'failed',id:93,updatedAt,reason:'checks-failed'},workflow:{state:'failed',id:73,attempt:2,name:'CI',failures:[{job:'extension',step:'Chromium extension E2E',conclusion:'failure',jobId:74}]}}},{repository:target.repository,number:44,title:'Handle missing workflow evidence',author:'guest',updatedAt,draft:false}]};
export const adoption = {metrics:[{id:'@oddmash/ui',kind:'npm',source:'https://www.npmjs.com/package/@oddmash/ui',count:133,observedAt:new Date().toISOString(),history:[{day:'2025-10-15',downloads:4},{day:'2025-11-15',downloads:5},...Array.from({length:30},(_,index)=>({day:new Date(Date.UTC(2025,11,index+2)).toISOString().slice(0,10),downloads:index===24?0:index%7===0?50:index})).filter((_,index)=>index!==26)]},{id:'@oddmash/juliya',kind:'npm',source:'https://www.npmjs.com/package/@oddmash/juliya',count:null,history:null,observedAt:new Date().toISOString()},{id:'oddmash.boundra-vscode',kind:'marketplace',source:'https://marketplace.visualstudio.com/items?itemName=oddmash.boundra-vscode',count:12,history:null,observedAt:new Date().toISOString()}]};
