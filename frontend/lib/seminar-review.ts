import type {Observation} from './seminar';

function similarity(a:string,b:string) {
 const tokens=(s:string)=>new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
 const x=tokens(a),y=tokens(b);
 return [...x].filter(t=>y.has(t)).length/Math.max(1,new Set([...x,...y]).size);
}
/** Keep a small, diverse selection; retain raw evidence for transcript notes. */
export function reviewHighlights(observations:Observation[],limit=6):Observation[] {
 const ranked=observations.filter(o=>o.review_status!=='inaccurate'&&o.review_status!=='uncertain')
 .slice().sort((a,b)=>(b.importance??1)-(a.importance??1)||Number(b.review_status==='confirmed')-Number(a.review_status==='confirmed')||a.start_ms-b.start_ms);
 const picked:Observation[]=[];
 for(const item of ranked){
  if(picked.filter(p=>p.dimension===item.dimension).length>=2)continue;
  if(picked.some(p=>p.dimension===item.dimension&&similarity(p.observed_action,item.observed_action)>.45))continue;
  picked.push(item);if(picked.length>=limit)break;
 }
 return picked.sort((a,b)=>a.start_ms-b.start_ms);
}
export function sentenceGestures(cue:{start_ms:number;end_ms:number},observations:Observation[]):Observation[] {
 return observations.filter(o=>o.dimension==='gesture_usage'&&o.review_status!=='inaccurate'&&o.review_status!=='uncertain'&&o.start_ms<cue.end_ms&&o.end_ms>=cue.start_ms)
 .filter((o,i,all)=>all.findIndex(p=>p.observed_action===o.observed_action)===i);
}
