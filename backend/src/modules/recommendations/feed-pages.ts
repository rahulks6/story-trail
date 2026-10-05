import {randomUUID} from 'node:crypto';
import {HttpError} from '../../http/errors';
import {query,queryOne} from '../../db/psql';
import {getRankedHomeFeed,rankFeatures} from './recommendation.service';
import {feedFeatures} from './feed-features.repository';
type SnapshotItem={id:string;score:number|null};
/** Shared across replicas/restarts; snapshots retain ordering, never stale content access. */
export async function homePage(viewer:string,limit:number,cursor?:string){
 if(!cursor){
  const ranked=await getRankedHomeFeed(viewer);
  if(ranked.length<=limit)return {feed:ranked,nextCursor:null};
  const id=randomUUID();
  await query(`WITH cleaned AS(DELETE FROM home_feed_snapshots WHERE id IN(SELECT id FROM home_feed_snapshots WHERE expires_at<=now() LIMIT 100)),old AS(DELETE FROM home_feed_snapshots WHERE viewer_id=:'viewer' AND id IN(SELECT id FROM home_feed_snapshots WHERE viewer_id=:'viewer' ORDER BY created_at DESC OFFSET 4)) INSERT INTO home_feed_snapshots(id,viewer_id,items) VALUES(:'id',:'viewer',:'items'::jsonb)`,{id,viewer,items:JSON.stringify(ranked.map(e=>({id:e.owner.id,score:Number.isFinite(e.score)?e.score:null})))});
  return {feed:ranked.slice(0,limit),nextCursor:`${id}:${limit}`};
 }
 const match=/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(\d{1,4})$/.exec(cursor);
 if(!match)throw new HttpError(422,'Invalid feed cursor.');
 const id=match[1]!,offset=Number(match[2]);
 const row=await queryOne(`SELECT items FROM home_feed_snapshots WHERE id=:'id' AND viewer_id=:'viewer' AND expires_at>now()`,{id,viewer});
 if(!row)throw new HttpError(410,'Feed refresh required.');
 const items=JSON.parse(row.items!) as SnapshotItem[];
 if(offset>items.length)throw new HttpError(422,'Invalid feed cursor.');
 const selected=items.slice(offset,offset+limit),allowed=await feedFeatures(viewer,selected.map(e=>e.id));
 const byId=new Map(allowed.map(f=>[f.owner.id,rankFeatures(f,viewer)]));
 return {feed:selected.flatMap(e=>{const item=byId.get(e.id);return item?[{...item,score:e.score??Infinity}]:[];}),nextCursor:offset+limit<items.length?`${id}:${offset+limit}`:null};
}
