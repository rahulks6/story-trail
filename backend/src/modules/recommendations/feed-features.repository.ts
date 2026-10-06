import {query} from '../../db/psql';
import type {Audience} from '../stories/stories.repository';
export interface FeedFeatures {
 owner:{id:string;username:string;displayName:string;avatarMediaId:string|null};isFollowing:boolean;
 stories:Array<{id:string;mediaId:string;caption:string;audience:Audience;createdAt:string;expiresAt:string}>;
 likes:number;comments:number;shares:number;views:number;profileVisits:number;replies:number;days:number;qualified:number;completions:number;continues:number;impressions:number;lifetime:number;
}
/** One grouped database read replaces per-creator and per-Story round trips. */
export async function feedFeatures(viewer:string,ids:string[]):Promise<FeedFeatures[]> {
 if(!ids.length)return [];
 const rows=await query(`WITH wanted AS(SELECT value::uuid AS id FROM jsonb_array_elements_text(:'ids'::jsonb)),
 owners AS(SELECT u.id,u.username,u.display_name,u.avatar_media_id,EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=:'viewer' AND f.followee_id=u.id) AS following
 FROM users u JOIN wanted w ON w.id=u.id WHERE u.deleted_at IS NULL AND u.is_active
 AND (u.id=:'viewer' OR ((NOT u.is_private OR EXISTS(SELECT 1 FROM follows f WHERE f.follower_id=:'viewer' AND f.followee_id=u.id))
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:'viewer' AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=:'viewer'))
 AND NOT EXISTS(SELECT 1 FROM mutes m WHERE m.muter_id=:'viewer' AND m.muted_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM creator_not_interested n WHERE n.viewer_id=:'viewer' AND n.creator_id=u.id)))),
 visible AS(SELECT s.* FROM stories s JOIN owners o ON o.id=s.owner_id WHERE s.deleted_at IS NULL AND s.expires_at>now() AND (s.owner_id=:'viewer' OR s.audience='public' OR o.following)),
 summaries AS(SELECT owner_id,jsonb_agg(jsonb_build_object('id',id,'mediaId',media_id,'caption',caption,'audience',audience,'createdAt',created_at,'expiresAt',expires_at) ORDER BY created_at,id) AS stories FROM visible GROUP BY owner_id),
 quality AS(SELECT owner_id,sum(likes) AS likes,sum(comments) AS comments,sum(shares) AS shares,sum(views) AS views FROM (
 SELECT s.owner_id,count(*) AS likes,0::bigint AS comments,0::bigint AS shares,0::bigint AS views FROM story_likes l JOIN visible s ON s.id=l.story_id GROUP BY s.owner_id
 UNION ALL SELECT s.owner_id,0,count(*),0,0 FROM story_comments c JOIN visible s ON s.id=c.story_id WHERE c.deleted_at IS NULL GROUP BY s.owner_id
 UNION ALL SELECT s.owner_id,0,0,count(*),0 FROM story_shares x JOIN visible s ON s.id=x.story_id GROUP BY s.owner_id
 UNION ALL SELECT s.owner_id,0,0,0,count(*) FROM story_views v JOIN visible s ON s.id=v.story_id GROUP BY s.owner_id) q GROUP BY owner_id),
 activity AS(SELECT e.creator_id,
 count(*) FILTER(WHERE e.viewer_id=:'viewer' AND e.event_type='profile_visit') AS visits,
 count(DISTINCT date_trunc('day',e.created_at)) FILTER(WHERE e.viewer_id=:'viewer' AND e.event_type IN ('story_impression','qualified_view')) AS days,
 count(*) FILTER(WHERE e.viewer_id=:'viewer' AND e.event_type='qualified_view') AS qualified,
 count(*) FILTER(WHERE e.viewer_id=:'viewer' AND e.event_type='story_complete') AS completions,
 count(*) FILTER(WHERE e.viewer_id=:'viewer' AND e.event_type='creator_sequence_continued') AS continues,
 count(*) FILTER(WHERE e.viewer_id=:'viewer' AND e.event_type='creator_impression') AS impressions,
 count(*) FILTER(WHERE e.event_type IN ('creator_impression','story_impression')) AS lifetime
 FROM recommendation_events e JOIN owners o ON o.id=e.creator_id GROUP BY e.creator_id),
 replies AS(SELECT s.owner_id,count(*) AS n FROM story_comments c JOIN stories s ON s.id=c.story_id JOIN owners o ON o.id=s.owner_id WHERE c.user_id=:'viewer' AND c.deleted_at IS NULL GROUP BY s.owner_id)
 SELECT jsonb_build_object('owner',jsonb_build_object('id',o.id,'username',o.username,'displayName',o.display_name,'avatarMediaId',o.avatar_media_id),'isFollowing',o.following,'stories',s.stories,
 'likes',coalesce(q.likes,0),'comments',coalesce(q.comments,0),'shares',coalesce(q.shares,0),'views',coalesce(q.views,0),
 'profileVisits',coalesce(a.visits,0),'days',coalesce(a.days,0),'qualified',coalesce(a.qualified,0),'completions',coalesce(a.completions,0),'continues',coalesce(a.continues,0),'impressions',coalesce(a.impressions,0),'lifetime',coalesce(a.lifetime,0),'replies',coalesce(r.n,0)) AS data
 FROM owners o JOIN summaries s ON s.owner_id=o.id LEFT JOIN quality q ON q.owner_id=o.id LEFT JOIN activity a ON a.creator_id=o.id LEFT JOIN replies r ON r.owner_id=o.id`,{viewer,ids:JSON.stringify(ids)});
 return rows.map(r=>JSON.parse(r.data!) as FeedFeatures);
}
