import {listEligibleCreatorIds} from './recommendation.repository';
import {feedFeatures,type FeedFeatures} from './feed-features.repository';
import {creatorAffinity,explorationMultiplier,freshness,storyQuality} from './scoring';
export interface RankedFeedEntry {owner:FeedFeatures['owner'];isFollowing:boolean;stories:FeedFeatures['stories'];score:number}
export function rankFeatures(features:FeedFeatures,viewer:string):RankedFeedEntry {
 const mostRecent=features.stories.reduce((latest,s)=>s.createdAt>latest.createdAt?s:latest,features.stories[0]!);
 const score=features.owner.id===viewer?Infinity:storyQuality({likeCount:features.likes,commentCount:features.comments,shareCount:features.shares,viewCount:features.views})*
 creatorAffinity({isFollowing:features.isFollowing,profileVisits:features.profileVisits,meaningfulReplies:features.replies,distinctEngagementDays:features.days,qualifiedViews:features.qualified,storyCompletions:features.completions,sequenceContinuations:features.continues,impressions:features.impressions})*
 freshness(new Date(mostRecent.createdAt),new Date(mostRecent.expiresAt))*explorationMultiplier(features.lifetime);
 return {owner:features.owner,isFollowing:features.owner.id===viewer?false:features.isFollowing,stories:features.stories,score};
}
/** Same organic formula, with grouped features and eligibility enforced before summaries leave the server. */
export async function getRankedHomeFeed(viewerId:string):Promise<RankedFeedEntry[]> {
 const candidates=await listEligibleCreatorIds(viewerId);
 const features=await feedFeatures(viewerId,[viewerId,...candidates]);
 return features.map(f=>rankFeatures(f,viewerId)).sort((a,b)=>b.score-a.score||a.owner.id.localeCompare(b.owner.id));
}
