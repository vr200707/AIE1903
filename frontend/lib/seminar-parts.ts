import type {SeminarPart, PartGroup} from "./seminar";
export const groupNames:Record<PartGroup,string>={introduction:"Introduction",body:"Body",conclusion:"Conclusion",other:"Other / Q&A"};
export const groups=Object.keys(groupNames) as PartGroup[];
export function splitPart(parts:SeminarPart[],id:string,at:number,newId:string,group?:PartGroup):SeminarPart[] {
 const index=parts.findIndex(p=>p.id===id),part=parts[index];
 if(!part || !Number.isInteger(at) || at<=part.start_ms || at>=part.end_ms)throw new Error("Choose a cut strictly inside this part.");
 return [...parts.slice(0,index),{...part,end_ms:at},{...part,id:newId,start_ms:at,group:group??part.group,title:group?groupNames[group]:`${part.title} (continued)`.slice(0,200),summary:""},...parts.slice(index+1)];
}
export function moveBoundary(parts:SeminarPart[],index:number,at:number):SeminarPart[] {
 if(index<1 || index>=parts.length || !Number.isInteger(at) || at<=parts[index-1].start_ms || at>=parts[index].end_ms)throw new Error("Keep the boundary between the neighbouring parts' outer edges.");
 return parts.map((p,i)=>i===index-1?{...p,end_ms:at}:i===index?{...p,start_ms:at}:p);
}
export function mergeBoundary(parts:SeminarPart[],index:number):SeminarPart[] {
 if(index<1 || index>=parts.length)throw new Error("Choose an internal boundary.");
 const left=parts[index-1],right=parts[index];
 return [...parts.slice(0,index-1),{...left,end_ms:right.end_ms,title:`${left.title} / ${right.title}`.slice(0,200),summary:[left.summary,right.summary].filter(Boolean).join("\n").slice(0,2000)},...parts.slice(index+1)];
}
export function sharedPart(part:SeminarPart,overlap?:[number,number]):[number,number]|null {
 if(!overlap)return null;
 const start=Math.max(part.start_ms,overlap[0]),end=Math.min(part.end_ms,overlap[1]);
 return end>start?[start,end]:null;
}
