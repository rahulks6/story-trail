import {listFollowedCreatorIds} from './recommendation.repository';
import {listDiscoveryCandidates,type Locality} from './reach.repository';
import {feedFeatures,type FeedFeatures} from './feed-features.repository';
import {viewerTopicProfile} from './topic-affinity.repository';
import {creatorAffinity,explorationMultiplier,freshness,interestMatch,storyQuality,topicWeights} from './scoring';
import {diversifyTopics,mixFeed,rankOrder} from './feed-mix';
import {reachSettings,type ReachSettings} from './reach';
import {topicsOf} from '../../shared/topics';
import {config} from '../../config/env';
export interface RankedFeedEntry {owner:FeedFeatures['owner'];isFollowing:boolean;stories:FeedFeatures['stories'];score:number;
 /** For ranking only (the route strips it): the creator's topics, the newest Story's first, and when that Story was posted. */
 ranking?:{topics:string[];primaryTopic:string|null;newestAt:string}}
/**
 * A creator's topics: each Story's own topic, and their profile interests for Stories without
 * one. The primary topic is the newest Story's.
 */
export function creatorTopics(features:Pick<FeedFeatures,'stories'|'interests'>):{topics:string[];primaryTopic:string|null;newestAt:string} {
 const newest=features.stories.reduce((latest,s)=>s.createdAt>latest.createdAt?s:latest,features.stories[0]!);
 const profile=topicsOf(features.interests??[]);
 const topics=new Set<string>();
 for(const s of features.stories){if(s.topic)topics.add(s.topic);else profile.forEach(t=>topics.add(t));}
 return {topics:[...topics],primaryTopic:newest.topic??profile[0]??null,newestAt:newest.createdAt};
}
/** `weights` (scoring.ts topicWeights) is the viewer's interests; without it interest doesn't move the score. */
export function rankFeatures(features:FeedFeatures,viewer:string,weights:ReadonlyMap<string,number>=new Map()):RankedFeedEntry {
 const ranking=creatorTopics(features);
 const mostRecent=features.stories.reduce((latest,s)=>s.createdAt>latest.createdAt?s:latest,features.stories[0]!);
 const score=features.owner.id===viewer?Infinity:storyQuality({likeCount:features.likes,commentCount:features.comments,shareCount:features.shares,viewCount:features.views})*
 creatorAffinity({isFollowing:features.isFollowing,profileVisits:features.profileVisits,meaningfulReplies:features.replies,distinctEngagementDays:features.days,qualifiedViews:features.qualified,storyCompletions:features.completions,sequenceContinuations:features.continues,impressions:features.impressions})*
 freshness(new Date(mostRecent.createdAt),new Date(mostRecent.expiresAt))*explorationMultiplier(features.lifetime)*
 interestMatch(weights,ranking.topics,features.isFollowing);
 return {owner:features.owner,isFollowing:features.owner.id===viewer?false:features.isFollowing,stories:features.stories,score,ranking};
}
/** Read once: the tuning doesn't change while the process runs (index.ts checks it at startup). */
let settings:ReachSettings|undefined;
const currentReachSettings=()=>settings??=reachSettings(config.reach.json);
/** New people read per Home load (nearest first, reach.repository.ts): a wide pool so interest can choose among them. */
const DISCOVERY_POOL=300;
/** New people kept on one Home after ranking. */
const DISCOVERY_KEPT=100;
/** Nearer new people rank a little higher: nearby, wider area, then the rest. Interest (up to 2.2x) outweighs it. */
const LOCALITY_BOOST:Record<Locality,number>={0:1.15,1:1.07,2:1,3:1};
/**
 * Home: your own Stories first, then a stable ranked order, best match first, that changes
 * only when something does (new Stories, new signals). People you follow (closeness first,
 * your interests second) and new people whose public Stories have earned reach to you (your
 * interests first, nearness second) are mixed 3 to 2 in a fixed pattern (feed-mix.ts), with no
 * more than three new people in a row on one topic while another is waiting. Each person
 * appears once. Eligibility is enforced before anything leaves the server.
 */
export async function getRankedHomeFeed(viewerId:string):Promise<RankedFeedEntry[]> {
 const [followedIds,discovery,profile]=await Promise.all([listFollowedCreatorIds(viewerId),listDiscoveryCandidates(viewerId,currentReachSettings(),DISCOVERY_POOL),viewerTopicProfile(viewerId)]);
 const weights=topicWeights(profile);
 const locality=new Map(discovery.map(d=>[d.ownerId,d.locality]));
 const ids=[...new Set([viewerId,...followedIds,...discovery.map(d=>d.ownerId)])];
 const entries=(await feedFeatures(viewerId,ids)).map(f=>rankFeatures(f,viewerId,weights));
 const sortable=(e:RankedFeedEntry)=>({...e,newestAt:e.ranking!.newestAt});
 const own=entries.filter(e=>e.owner.id===viewerId);
 const followed=rankOrder(entries.filter(e=>e.owner.id!==viewerId&&e.isFollowing).map(sortable));
 const fresh=rankOrder(entries.filter(e=>e.owner.id!==viewerId&&!e.isFollowing).map(e=>sortable({...e,score:e.score*LOCALITY_BOOST[locality.get(e.owner.id)??3]}))).slice(0,DISCOVERY_KEPT);
 const strip=({newestAt:_n,...e}:RankedFeedEntry&{newestAt:string}):RankedFeedEntry=>e;
 return [...own,...mixFeed(followed,diversifyTopics(fresh,e=>e.ranking!.primaryTopic)).map(strip)];
}
