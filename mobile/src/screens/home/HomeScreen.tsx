import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {StorySkeleton} from '../../components/Skeleton';
import { AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import {useIsFocused,useNavigation,type CompositeNavigationProp} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import { mediaColors as colors, spacing, mediaTypography as typography, ICONS } from '../../theme';
import {Icon} from '../../components/Icon';
import {useNotifications} from '../../state/NotificationsContext';
import {useScreenInsets} from '../../hooks/useScreenInsets';
import {UploadStatusPill} from '../../components/UploadStatusPill';
import {useAuth} from '../../state/AuthContext';
import {onProfileChanged,onStoryPublished} from '../../state/storyChanges';
import {getRankedHomeFeed,type RankedFeedEntry} from '../../api/stories';
import {EmptyState} from '../../components/EmptyState';
import {StoryFeed} from '../story/StoryFeed';
import {extendSlots,type HomeSlot} from '../../models/homeSlots';
import {HomeDiscover} from '../../components/HomeDiscover';
import {getAdPlacements,type SponsoredPlacement} from '../../api/ads';
import {useFestival} from '../../hooks/useFestival';
import type {MainTabParamList,RootStackParamList} from '../../navigation/types';
import {shareInvite} from '../../state/invites';
import {ContactsJoinedSheet} from '../../components/ContactsJoinedSheet';
import { t } from "../../i18n";
/** Away from Home (another tab, a screen on top, the app in the background) this long: the feed is reloaded on return. */
export const HOME_STALE_MS=3*60*1000;
type HomeNavigationProp=CompositeNavigationProp<BottomTabNavigationProp<MainTabParamList,'Home'>,NativeStackNavigationProp<RootStackParamList>>;
export function HomeScreen():React.JSX.Element {
  useMediaStatusBar();
 const {accessToken,user}=useAuth();const navigation=useNavigation<HomeNavigationProp>();
 const {unreadCount}=useNotifications();const insets=useScreenInsets();
 // Activity (likes, comments, follows) is the bell at the top right: a heart there would sit beside the Story's own like.
 const activityButton=<Pressable onPress={()=>navigation.navigate('Activity')} hitSlop={12} style={[styles.activity,{top:insets.top+spacing.lg}]} accessibilityRole="button" accessibilityLabel={unreadCount>0?t("home.activityUnreadcountNew", { unreadCount }):t("common.activity")}>
  <Icon name={ICONS.notifications} size={24} color={colors.textPrimary}/>{unreadCount>0?<View style={styles.activityDot}/>:null}
 </Pressable>;
 const uploads=<UploadStatusPill top={insets.top+spacing.xl+spacing.sm}/>;
 const [feed,setFeed]=useState<RankedFeedEntry[]|null>(null),[retry,setRetry]=useState(0),[error,setError]=useState(''),[cursor,setCursor]=useState<string|null>(null),[sponsored,setSponsored]=useState<SponsoredPlacement[]>([]);
 // On a festival day: its emoji in a round button beside Activity opens everyone's festival Stories (or the camera),
 // so the top left stays the Story's own name, time and music.
 const {current:festivalInfo,reload:reloadFestival}=useFestival();const festival=festivalInfo?.festival??null;const festivalCreators=festivalInfo?.creators??[];
 const openFestival=useCallback(()=>{if(festivalCreators.length)navigation.navigate('StoryViewer',{creators:festivalCreators,startIndex:0});else navigation.navigate('Create');},[festivalCreators,navigation]);
 const festivalButton=festival?<Pressable onPress={openFestival} hitSlop={8} style={[styles.festival,{top:insets.top+spacing.lg}]} accessibilityRole="button" accessibilityLabel={festivalCreators.length?t("home.nameStoriesStorycount", { name: festival.name, storyCount: festivalInfo?.storyCount??0 }):t("home.postYourNameStory", { name: festival.name })}>
  <Text style={styles.festivalEmoji}>{festival.emoji}</Text>{festivalCreators.length?<View style={styles.festivalCount}><Text style={styles.festivalCountLabel}>{festivalInfo!.storyCount>99?'99+':festivalInfo!.storyCount}</Text></View>:null}
 </Pressable>:null;
 const token=useRef(accessToken);token.current=accessToken;const request=useRef(0),loadingMore=useRef(false);
 useEffect(()=>onStoryPublished(()=>{setRetry(n=>n+1);reloadFestival();}),[reloadFestival]);
 // Your own Story's name and photo come from the feed: reload after an Edit Profile save.
 useEffect(()=>onProfileChanged(()=>setRetry(n=>n+1)),[]);
 // Returning from Profile/DM/overlays does not remount the viewer or restart its playback.
 useEffect(()=>{const generation=++request.current;const currentToken=token.current;if(!currentToken)return;setFeed(null);setCursor(null);setSponsored([]);setError('');setRefreshing(false);loadingMore.current=false;
  void getRankedHomeFeed(currentToken).then(result=>{if(generation!==request.current)return;setFeed(result.feed);setCursor(result.nextCursor);if(result.sponsoredEnabled)void getAdPlacements(result.feed.length,currentToken).then(r=>{if(generation===request.current)setSponsored(r.items);}).catch(()=>undefined);}).catch(()=>{if(generation===request.current)setError(t("home.couldntLoadStoriesCheckYour"));});
  return()=>{request.current++;};
 },[user?.id,retry]);
 const more=useCallback(()=>{if(!cursor||!token.current||loadingMore.current)return;loadingMore.current=true;const generation=request.current;
  void getRankedHomeFeed(token.current,cursor).then(result=>{if(generation!==request.current)return;setFeed(previous=>{const ids=new Set(previous?.map(e=>e.owner.id));return [...(previous??[]),...result.feed.filter(e=>!ids.has(e.owner.id))];});setCursor(result.nextCursor);setError('');}).catch(()=>{if(generation===request.current)setError(t("home.moreStoriesCouldNotLoad"));}).finally(()=>{if(generation===request.current)loadingMore.current=false;});
 },[cursor]);
 const refresh=()=>setRetry(n=>n+1);
 // Caught up, or nothing to watch yet: friends who join bring their Stories with them.
 const invite=()=>void shareInvite('home',accessToken,user?.id);
 // A fresh feed without blanking the screen: what's showing stays until the new one arrives, and the
 // viewer restarts only if the line-up of creators changed (it renews its own expired links otherwise).
 const feedRef=useRef(feed);feedRef.current=feed;
 const [version,setVersion]=useState(0),[refreshing,setRefreshing]=useState(false);
 const reloadQuietly=useCallback(()=>{const currentToken=token.current;if(!currentToken)return;const generation=++request.current;loadingMore.current=false;setRefreshing(true);
  void getRankedHomeFeed(currentToken).then(result=>{if(generation!==request.current)return;const previous=feedRef.current;const same=!!previous&&previous.length===result.feed.length&&previous.every((e,i)=>e.owner.id===result.feed[i]!.owner.id&&e.isFollowing===result.feed[i]!.isFollowing);
   if(!same){setFeed(result.feed);setSponsored([]);setVersion(n=>n+1);if(result.sponsoredEnabled)void getAdPlacements(result.feed.length,currentToken).then(r=>{if(generation===request.current)setSponsored(r.items);}).catch(()=>undefined);}
   setCursor(result.nextCursor);setError('');}).catch(()=>undefined).finally(()=>{if(generation===request.current)setRefreshing(false);});
 },[]);
 // Coming back after a while (signed media links expire, new Stories are up): reload, but not on every focus.
 const focused=useIsFocused();const focusedRef=useRef(focused);focusedRef.current=focused;const awaySince=useRef<number|null>(null);
 useEffect(()=>{if(!focused){awaySince.current??=Date.now();return;}const since=awaySince.current;awaySince.current=null;if(since!==null&&Date.now()-since>HOME_STALE_MS)reloadQuietly();},[focused,reloadQuietly]);
 useEffect(()=>{const subscription=AppState.addEventListener('change',next=>{
  if(next!=='active'){awaySince.current??=Date.now();return;}
  if(!focusedRef.current)return;const since=awaySince.current;awaySince.current=null;if(since!==null&&Date.now()-since>HOME_STALE_MS)reloadQuietly();
 });return()=>subscription.remove();},[reloadQuietly]);
 // One Story at a time, taking turns between people (models/homeSlots.ts); a next page adds to the end.
 const slotsRef=useRef<{feed:RankedFeedEntry[]|null;slots:HomeSlot[]}>({feed:null,slots:[]});
 const slots=useMemo(()=>{const next=feed?extendSlots(feed,slotsRef.current.feed,slotsRef.current.slots):[];slotsRef.current={feed,slots:next};return next;},[feed]);
 const creators=useMemo(()=>slots.map(slot=>slot.username),[slots]);
 const slotStoryIds=useMemo(()=>slots.map(slot=>slot.storyId),[slots]);
 const following=useMemo(()=>Object.fromEntries((feed??[]).map(e=>[e.owner.username,e.isFollowing])),[feed]);
 const verified=useMemo(()=>Object.fromEntries((feed??[]).map(e=>[e.owner.username,!!e.owner.verified])),[feed]);
 // initial:false keeps Search's own first screen under the profile, so the Search tab still works after.
 // Over the Story: closing "Send to" comes back to the same Story.
 const openDM=useCallback(({storyId,ownerUsername}:{storyId:string;ownerUsername:string})=>navigation.navigate('SendStory',{storyId,ownerUsername}),[navigation]);
 const openProfile=useCallback((username:string)=>navigation.navigate('Search',{screen:'UserProfile',initial:false,params:{username}}),[navigation]);
 // "Priya joined Katkee": for people who turned on "Tell me when more contacts join".
 const contactsJoined=<ContactsJoinedSheet onOpenProfile={openProfile} onFollowed={reloadQuietly}/>;
 const discover=<HomeDiscover accessToken={accessToken} onFollowed={reloadQuietly} onOpenProfile={openProfile}
  onOpenStories={(tiles,index)=>navigation.navigate('StoryViewer',{creators:tiles.map(tile=>tile.owner.username),startIndex:index,initialStoryId:tiles[index]?.story.id,verifiedCreators:tiles.filter(tile=>tile.owner.verified).map(tile=>tile.owner.username)})}/>;
 if(feed===null&&!error)return <View style={styles.root}><StorySkeleton/>{festivalButton}{activityButton}{uploads}</View>;
 if(feed===null)return <View style={styles.empty}><EmptyState variant="media" title={t("home.couldntLoadStories")} message={t("home.checkYourConnectionAndTry")}>
  <Pressable onPress={refresh} style={styles.emptyButton} accessibilityRole="button"><Text style={styles.emptyButtonLabel}>{t("common.tryAgain")}</Text></Pressable>
 </EmptyState>{festivalButton}{activityButton}</View>;
 // Pull down (or tap Refresh) to look again; Find people for someone to follow.
 if(!feed.length)return <View style={styles.root}><ScrollView contentContainerStyle={styles.emptyScroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadQuietly} tintColor={colors.textPrimary} colors={[colors.accentText]}/>}>
  {festival?<View style={styles.festivalCard}>
   <Text style={styles.festivalCardEmoji}>{festival.emoji}</Text>
   <Text style={styles.festivalCardTitle}>{festival.greeting}!</Text>
   {festivalCreators.length?<Pressable onPress={openFestival} style={styles.festivalCardButton} accessibilityRole="button"><Text style={styles.festivalCardButtonLabel}>{t("home.seeFestivalStories", { count: festivalInfo?.storyCount ?? 0, festival: festival.name })}</Text></Pressable>:null}
   <Pressable onPress={()=>navigation.navigate('Create')} style={styles.emptyButton} accessibilityRole="button"><Text style={styles.emptyButtonLabel}>{t("home.postYourNameStory", { name: festival.name })}</Text></Pressable>
  </View>:null}
  {/* Never an empty Home: people to follow and popular Stories, so a new person has something at once. */}
  <View style={[styles.welcome,{paddingTop:insets.top+spacing.xxl*2}]}>
   <Text style={styles.welcomeTitle}>{t("homeDiscover.welcomeTitle")}</Text>
   <Text style={styles.welcomeText}>{t("homeDiscover.welcomeText")}</Text>
  </View>
  {discover}
  <View style={styles.emptyActions}>
   <Pressable onPress={()=>navigation.navigate('Create')} style={[styles.emptyButton,styles.emptyButtonStrong]} accessibilityRole="button"><Text style={[styles.emptyButtonLabel,styles.emptyButtonLabelStrong]}>{t("homeDiscover.postFirstStory")}</Text></Pressable>
   <Pressable onPress={()=>navigation.navigate('Search',{screen:'SearchHome'})} style={styles.emptyButton} accessibilityRole="button"><Text style={styles.emptyButtonLabel}>{t("common.findPeople")}</Text></Pressable>
   <Pressable onPress={invite} style={styles.emptyButton} accessibilityRole="button"><Text style={styles.emptyButtonLabel}>{t("common.inviteFriends")}</Text></Pressable>
   <Pressable onPress={reloadQuietly} disabled={refreshing} style={styles.emptyButton} accessibilityRole="button" accessibilityLabel={t("home.refreshStories")}><Text style={styles.emptyButtonLabel}>{refreshing?t("home.refreshing"):t("common.refresh")}</Text></Pressable>
  </View>
 </ScrollView>{festivalButton}{activityButton}{uploads}{contactsJoined}</View>;
 return <View style={styles.root}><StoryFeed key={`${user?.id}:${retry}:${version}`} creators={creators} slotStoryIds={slotStoryIds} following={following} verified={verified} startIndex={0} sponsored={sponsored} onNeedMore={more} onRefresh={refresh}
  onCreate={()=>navigation.navigate('Create')} onFindPeople={()=>navigation.navigate('Search',{screen:'SearchHome'})} onInvite={invite} discover={discover}
  onOpenDM={openDM} onOpenProfile={openProfile}
  onOpenCreate={()=>navigation.navigate('Create')} onOpenStory={(username,storyId)=>navigation.navigate('StoryViewer',{creators:[username],startIndex:0,initialStoryId:storyId})}/>
  {!!error&&<View style={[styles.error,{top:insets.top+spacing.xl+40}]}><Text style={typography.caption}>{error}</Text><Pressable onPress={more} accessibilityRole="button"><Text style={typography.body}>{t("common.retry")}</Text></Pressable><Pressable onPress={refresh} accessibilityRole="button"><Text style={typography.body}>{t("common.refresh")}</Text></Pressable></View>}
  {festivalButton}{activityButton}{uploads}{contactsJoined}
 </View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},festival:{position:'absolute',right:spacing.md+44,width:36,height:36,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(0,0,0,0.3)'},festivalEmoji:{fontSize:20},festivalCount:{position:'absolute',top:-4,right:-6,minWidth:18,height:18,borderRadius:9,paddingHorizontal:4,alignItems:'center',justifyContent:'center',backgroundColor:colors.accent},festivalCountLabel:{fontSize:11,fontWeight:'800',color:colors.onAccent},festivalCard:{alignItems:'center',gap:spacing.md,paddingTop:spacing.xxl*2,paddingHorizontal:spacing.xl},festivalCardEmoji:{fontSize:56},festivalCardTitle:{...typography.title,textAlign:'center'},festivalCardButton:{paddingHorizontal:spacing.lg,paddingVertical:spacing.sm,borderRadius:20,backgroundColor:colors.accent},festivalCardButtonLabel:{...typography.body,fontWeight:'700',color:colors.onAccent},activity:{position:'absolute',right:spacing.md,width:36,height:36,borderRadius:18,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(0,0,0,0.3)'},activityDot:{position:'absolute',top:6,right:7,width:9,height:9,borderRadius:5,backgroundColor:colors.like,borderWidth:1.5,borderColor:colors.background},empty:{flex:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center'},error:{position:'absolute',left:16,right:16,padding:12,gap:8,backgroundColor:colors.surfaceElevated},emptyScroll:{flexGrow:1},emptyActions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:spacing.md,paddingHorizontal:spacing.md,paddingBottom:spacing.xxl*2},emptyButton:{paddingHorizontal:spacing.lg,paddingVertical:spacing.sm,borderRadius:20,borderWidth:1,borderColor:colors.textPrimary},emptyButtonLabel:{...typography.body,fontWeight:'700'},emptyButtonStrong:{backgroundColor:colors.accent,borderColor:colors.accent},emptyButtonLabelStrong:{color:colors.onAccent},welcome:{paddingHorizontal:spacing.md,gap:spacing.xs},welcomeTitle:{...typography.title},welcomeText:{...typography.body,color:colors.textSecondary}});
