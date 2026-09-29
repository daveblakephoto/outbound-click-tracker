/** Session observations from Analytics Engine. Never represent these as exact leads. */
export type BehaviourEvent = { name: string; page: string; count: number; sampledRows?: number; maxSampleInterval?: number; custom: Record<string, unknown> };
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const path = (v: unknown) => { const s=text(v); return s.startsWith('/') ? s.split(/[?#]/)[0].replace(/\/$/, '') || '/' : ''; };
const time = (v: unknown) => { const n=Date.parse(text(v)); return Number.isFinite(n)?n:null; };
const truth = (v: unknown) => v===true || v==='true' || v===1 || v==='1';
const aliases = {
 session: ['session_id', 'sessionId'],
 timestamp: ['event_ts_client', 'eventTsClient', 'ts_iso'],
 page: ['page_path', 'pagePath', 'source_path', 'sourcePath'],
 landing: ['first_touch_landing_page', 'firstTouchLandingPage', 'landing_page', 'landingPage'],
 source: ['first_touch_source', 'firstTouchSource'],
 errorType: ['error_type', 'errorType'],
 errorClass: ['error_class', 'errorClass'],
 field: ['field_name', 'fieldName'],
 destination: ['to_path', 'toPath', 'target_path', 'targetPath'],
 domain: ['target_domain', 'targetDomain']
} as const;
const read = (c: Record<string, unknown>, keys: readonly string[]) => {
 for(const key of keys) if(c[key] !== undefined && c[key] !== null) return c[key];
 return undefined;
};
const eventTime = (e: BehaviourEvent) => time(read(e.custom, aliases.timestamp));
export function knownTestReason(c: Record<string, unknown>): string {
  if(truth(c.is_test_traffic ?? c.isTestTraffic ?? c.test_traffic)) return 'explicit_test';
  // Narrow historical marker used by our own audit, not a guess based on visitor identity.
  if([c.referral_source,c.referralSource,c.agency_slug,c.agencySlug,c.representation,c.represented_by,c.representedBy].some(v=>text(v).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')==='codex_robustness_audit')) return 'known_audit';
  return '';
}
export function buildBehaviourInsights(events: BehaviourEvent[], excludedTestEstimate=0) {
 const sessions=new Map<string, {events:BehaviourEvent[]}>();
 let missingSessionEstimate=0, sampled=false, samplingKnown=true, sampledRows=0, estimatedEvents=0;
 for(const e of events){
  estimatedEvents+=e.count;
  if(e.sampledRows===undefined || e.maxSampleInterval===undefined) samplingKnown=false;
  sampledRows+=e.sampledRows||0;sampled ||= (e.maxSampleInterval||1)>1;
  const id=text(read(e.custom, aliases.session));
  if(!id){missingSessionEstimate+=e.count;continue;}
  if(!sessions.has(id))sessions.set(id,{events:[]});sessions.get(id)!.events.push(e);
 }
 const names=['db_contact_form_view','db_contact_form_start','db_contact_form_submit_attempt','db_contact_form_submit_success'];
 const observed=names.map(()=>0),linked=names.map(()=>0);
 const landings=new Map<string, any>(),sources=new Map<string, any>(),pathways=new Map<string, any>(),errors=new Map<string, any>(),transitions=new Map<string, any>();
 let modelSuccessSessions=0, successWithoutAttempt=0,unknownLandingSessions=0,unknownSourceSessions=0, missingTimestampSessions=0;
 const summary=(map:Map<string,any>,key:string)=>{if(!map.has(key))map.set(key,{key,sessions:0,formViews:0,formStarts:0,attempts:0,successes:0});return map.get(key);};
 for(const {events:es} of sessions.values()){
  const ordered=[...es].sort((a,b)=>(eventTime(a)??Infinity)-(eventTime(b)??Infinity));
  const modelEvents=ordered.filter(e=>path(read(e.custom, aliases.page)).startsWith('/models/contact') || e.page==='models-contact');
  const sets=names.map(name=>modelEvents.filter(e=>e.name===name));const present=sets.map(a=>a.length>0);
  present.forEach((v,i)=>{if(v)observed[i]++;});
  if(present[3]){modelSuccessSessions++;if(!present[2])successWithoutAttempt++;}
  let previous=-Infinity;
  for(let i=0;i<sets.length;i++){
   const ts=sets[i].map(eventTime).filter((v):v is number=>v!==null && v>=previous).sort((a,b)=>a-b)[0];
   if(ts===undefined)break;linked[i]++;previous=ts;
  }
  if(modelEvents.some(e=>names.includes(e.name)&&eventTime(e)===null))missingTimestampSessions++;
  const landing=ordered.map(e=>path(read(e.custom, aliases.landing))).find(Boolean)||'unknown';
  const source=ordered.map(e=>text(read(e.custom, aliases.source))).find(Boolean)||'unknown';
  if(landing==='unknown')unknownLandingSessions++;if(source==='unknown')unknownSourceSessions++;
  for(const row of [summary(landings,landing),summary(sources,source)]){row.sessions++;['formViews','formStarts','attempts','successes'].forEach((k,i)=>{if(present[i])row[k]++;});}
  // Attribute the form to the last nonempty pathway observed; don't count one session in several pathways.
  const pathway=[...modelEvents].reverse().map(e=>text(e.custom.pathway)).find(v=>v&&v!=='not_provided')||'unknown';
  if(present.some(Boolean)){const row=summary(pathways,pathway);row.sessions++;['formViews','formStarts','attempts','successes'].forEach((k,i)=>{if(present[i])row[k]++;});}
  const seenErrors=new Set<string>(),seenLinks=new Set<string>();
  for(const e of modelEvents){
   if(!/error$/.test(e.name))continue;
   const type=text(read(e.custom, aliases.errorType))||text(read(e.custom, aliases.errorClass))||'unknown',field=text(read(e.custom, aliases.field))||'';const key=type+'|'+field;
   if(seenErrors.has(key))continue;seenErrors.add(key);
   if(!errors.has(key))errors.set(key,{type,field,sessions:0,laterSuccessSessions:0});const row=errors.get(key);row.sessions++;
   const errorTime=eventTime(e);
   if(errorTime!==null&&sets[3].some(s=>(eventTime(s)??-Infinity)>errorTime))row.laterSuccessSessions++;
  }
  for(const e of ordered){
   if(!e.name.includes('click'))continue;
   const from=path(read(e.custom, aliases.page)),to=path(read(e.custom, aliases.destination));const domain=text(read(e.custom, aliases.domain));
   if(!from||(!to&&!domain))continue;
   const destination=domain&&domain!=='dave-blake.com' ? domain+(to||'') : to;
   const key=from+' → '+destination;if(seenLinks.has(key))continue;seenLinks.add(key);
   if(!transitions.has(key))transitions.set(key,{from,to:destination,sessions:0});transitions.get(key).sessions++;
  }
 }
 const sorted=(m:Map<string,any>)=>[...m.values()].sort((a,b)=>b.sessions-a.sessions);
 return { version:1, measurement:'observed_sessions_not_verified_leads', quality:{samplingKnown,sampled,sampledRows: samplingKnown?sampledRows:null,estimatedEvents,excludedTestEstimate,missingSessionEstimate,observedSessions:sessions.size,unknownLandingSessions,unknownSourceSessions,missingTimestampSessions,modelSuccessSessions,successWithoutAttempt},
  funnel:names.map((event,i)=>({event,observedSessions:observed[i],orderedSessions:linked[i]})),
  landingPages:sorted(landings),sources:sorted(sources),pathways:sorted(pathways),errors:sorted(errors),transitions:sorted(transitions).slice(0,100),
  limitations:['Observed sessions can be incomplete when events are sampled or blocked.','Success events are browser-reported, not a verified booking or revenue ledger.','Ordered funnel requires matching session IDs and client timestamps; missing steps are not proof of abandonment.']};
}
