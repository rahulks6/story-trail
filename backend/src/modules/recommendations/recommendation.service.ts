import {listFollowedCreatorIds} from './recommendation.repository';
import {listDiscoveryCandidates,type Locality} from './reach.repository';
import {feedFeatures,type FeedFeatures} from './feed-features.repository';
import {creatorAffinity,explorationMultiplier,freshness,storyQuality} from './scoring';
import {mixFeed,weightedShuffle} from './feed-mix';
import {reachSettings,type ReachSettings} from './reach';
import {config} from '../../config/env';
export interface RankedFeedEntry {owner:FeedFeatures['owner'];isFollowing:boolean;stories:FeedFeatures['stories'];score:number}
export function rankFeatures(features:FeedFeatures,viewer:string):RankedFeedEntry {
 const mostRecent=features.stories.reduce((latest,s)=>s.createdAt>latest.createdAt?s:latest,features.stories[0]!);
 const score=features.owner.id===viewer?Infinity:storyQuality({likeCount:features.likes,commentCount:features.comments,shareCount:features.shares,viewCount:features.views})*
 creatorAffinity({isFollowing:features.isFollowing,profileVisits:features.profileVisits,meaningfulReplies:features.replies,distinctEngagementDays:features.days,qualifiedViews:features.qualified,storyCompletions:features.completions,sequenceContinuations:features.continues,impressions:features.impressions})*
 freshness(new Date(mostRecent.createdAt),new Date(mostRecent.expiresAt))*explorationMultiplier(features.lifetime);
 return {owner:features.owner,isFollowing:features.owner.id===viewer?false:features.isFollowing,stories:features.stories,score};
}
/** Read once: the tuning doesn't change while the process runs (index.ts checks it at startup). */
let settings:ReachSettings|undefined;
const currentReachSettings=()=>settings??=reachSettings(config.reach.json);
/** New people read per Home load: the nearest first (reach.repository.ts). */
const DISCOVERY_CANDIDATES=100;
/** Nearer new people rank higher: nearby, wider area, same time zone, unknown or further. */
const LOCALITY_BOOST:Record<Locality,number>={0:1.6,1:1.25,2:1,3:1};
/**
 * Home (Phase 9): your own Stories first, then a different shuffle on every refresh of people
 * you follow (about 60%, always first) and new people whose public Stories have earned reach
 * to you (about 40%, nearest favoured). Better-scoring creators tend to come earlier in each.
 * Eligibility is enforced before anything leaves the server.
 */
export async function getRankedHomeFeed(viewerId:string,random:()=>number=Math.random):Promise<RankedFeedEntry[]> {
 const [followedIds,discovery]=await Promise.all([listFollowedCreatorIds(viewerId),listDiscoveryCandidates(viewerId,currentReachSettings(),DISCOVERY_CANDIDATES)]);
 const locality=new Map(discovery.map(d=>[d.ownerId,d.locality]));
 const entries=(await feedFeatures(viewerId,[viewerId,...followedIds,...discovery.map(d=>d.ownerId)])).map(f=>rankFeatures(f,viewerId));
 const own=entries.filter(e=>e.owner.id===viewerId);
 const followed=entries.filter(e=>e.owner.id!==viewerId&&e.isFollowing);
 const fresh=entries.filter(e=>e.owner.id!==viewerId&&!e.isFollowing).map(e=>({...e,score:e.score*LOCALITY_BOOST[locality.get(e.owner.id)??3]}));
 return [...own,...mixFeed(weightedShuffle(followed,e=>e.score,random),weightedShuffle(fresh,e=>e.score,random),random)];
}
