import {expect,test} from 'vitest';
import {buildBehaviourInsights,knownTestReason,type BehaviourEvent} from '../src/behaviour-insights';
const event=(name:string,session:string,second:number,extra:Record<string,unknown>={}):BehaviourEvent=>({name,page:'models-contact',count:5,sampledRows:1,maxSampleInterval:5,custom:{session_id:session,event_ts_client:`2026-09-10T00:00:${String(second).padStart(2,'0')}Z`,page_path:'/models/contact/',first_touch_landing_page:'/articles/agencies/',first_touch_source:'www.google.com',pathway:'digitals-only',...extra}});
test('counts observed sessions, not sampling weights, and requires ordered matching steps',()=>{
 const es=[event('db_contact_form_view','one',1),event('db_contact_form_start','one',2),event('db_contact_form_submit_attempt','one',3),event('db_contact_form_submit_success','one',4),event('db_contact_form_submit_success','one',5),event('db_contact_form_submit_success','orphan',1)];
 const r=buildBehaviourInsights(es,5);
 expect(r.quality.modelSuccessSessions).toBe(2);expect(r.quality.successWithoutAttempt).toBe(1);expect(r.quality.sampled).toBe(true);
 expect(r.funnel.map(s=>s.orderedSessions)).toEqual([1,1,1,1]);expect(r.quality.estimatedEvents).toBe(30);
 expect(r.landingPages[0]).toMatchObject({sessions:2,successes:2});
});
test('does not claim funnel completion when success precedes attempt or timestamps are absent',()=>{
 const es=[event('db_contact_form_view','one',1),event('db_contact_form_start','one',2),event('db_contact_form_submit_attempt','one',5),event('db_contact_form_submit_success','one',3),event('db_contact_form_view','two',1,{event_ts_client:''})];
 const r=buildBehaviourInsights(es);expect(r.funnel.map(s=>s.orderedSessions)).toEqual([1,1,1,0]);expect(r.quality.missingTimestampSessions).toBe(1);
});
test('tracks blocker recovery per session and only after the error',()=>{
 const r=buildBehaviourInsights([event('db_contact_form_submit_error','one',1,{error_type:'server_5xx'}),event('db_contact_form_submit_success','one',2),event('db_contact_form_submit_error','two',5,{error_type:'server_5xx'}),event('db_contact_form_submit_success','two',3)]);
 expect(r.errors[0]).toMatchObject({sessions:2,laterSuccessSessions:1});
});
test('identifies explicit tests and the specific historical audit without guessing ordinary referrals',()=>{
 expect(knownTestReason({is_test_traffic:'true'})).toBe('explicit_test');expect(knownTestReason({referral_source:'codex_robustness_audit'})).toBe('known_audit');expect(knownTestReason({referral_source:'website'})).toBe('');
});
test('does not fabricate unsampled certainty when API fields are unavailable',()=>{
 const e=event('db_contact_form_view','one',1);delete e.sampledRows;delete e.maxSampleInterval;
 const r=buildBehaviourInsights([e]);expect(r.quality.samplingKnown).toBe(false);expect(r.quality.sampledRows).toBe(null);
});

test('recognises the historical audit representation label',()=>{expect(knownTestReason({representation:'Codex robustness audit'})).toBe('known_audit');});

test('reads a complete historical camelCase journey without false missing timestamps',()=>{
 const historical=(name:string,second:number,extra:Record<string,unknown>={}):BehaviourEvent=>({
  name,page:'legacy-page',count:1,custom:{
   sessionId:'historical-session-123',eventTsClient:`2026-09-10T00:00:${String(second).padStart(2,'0')}Z`,
   pagePath:'/models/contact/',firstTouchLandingPage:'/models/digitals/',
   firstTouchSource:'Search',pathway:'digitals-only',...extra
  }
 });
 const result=buildBehaviourInsights([
  historical('db_cta_click',0,{pagePath:'/models/digitals/',toPath:'/models/contact/',targetDomain:'dave-blake.com'}),
  historical('db_contact_form_view',1),
  historical('db_contact_form_start',2),
  historical('db_contact_form_validation_error',3,{errorType:'validation',errorClass:'validation',fieldName:'email'}),
  historical('db_contact_form_submit_attempt',4),
  historical('db_contact_form_submit_success',5)
 ],0,['dave-blake.com']);
 expect(result.funnel.map(step=>step.orderedSessions)).toEqual([1,1,1,1]);
 expect(result.quality.missingTimestampSessions).toBe(0);
 expect(result.quality.modelSuccessSessions).toBe(1);
 expect(result.landingPages[0]).toMatchObject({key:'/models/digitals',successes:1});
 expect(result.sources[0]).toMatchObject({key:'Search',successes:1});
 expect(result.pathways[0]).toMatchObject({key:'digitals-only',successes:1});
 expect(result.errors[0]).toMatchObject({type:'validation',field:'email',sessions:1,laterSuccessSessions:1});
 expect(result.transitions[0]).toMatchObject({from:'/models/digitals',to:'/models/contact',sessions:1});
});
