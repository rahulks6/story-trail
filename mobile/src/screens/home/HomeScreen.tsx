import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {StorySkeleton} from '../../components/Skeleton';
import {AppState,Pressable,RefreshControl,ScrollView,StyleSheet,Text,View} from 'react-native';
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
import {getAdPlacements,type SponsoredPlacement} from '../../api/ads';
import type {MainTabParamList,RootStackParamList} from '../../navigation/types';
/** Away from Home (another tab, a screen on top, the app in the background) this long: the feed is reloaded on return. */
export const HOME_STALE_MS=3*60*1000;
type HomeNavigationProp=CompositeNavigationProp<BottomTabNavigationProp<MainTabParamList,'Home'>,NativeStackNavigationProp<RootStackParamList>>;
export function HomeScreen():React.JSX.Element {
  useMediaStatusBar();
 const {accessToken,user}=useAuth();const navigation=useNavigation<HomeNavigationProp>();
 const {unreadCount}=useNotifications();const insets=useScreenInsets();
 // Activity (likes, comments, follows) lives behind the heart at the top, like Instagram.
 const activityButton=<Pressable onPress={()=>navigation.navigate('Activity')} hitSlop={12} style={[styles.activity,{top:insets.top+spacing.lg}]} accessibilityRole="button" accessibilityLabel={unreadCount>0?`Activity, ${unreadCount} new`:'Activity'}>
  <Icon name={ICONS.activity} size={26} color={colors.textPrimary}/>{unreadCount>0?<View style={styles.activityDot}/>:null}
 </Pressable>;
 const uploads=<UploadStatusPill top={insets.top+spacing.xl+spacing.sm}/>;
 const [feed,setFeed]=useState<RankedFeedEntry[]|null>(null),[retry,setRetry]=useState(0),[error,setError]=useState(''),[cursor,setCursor]=useState<string|null>(null),[sponsored,setSponsored]=useState<SponsoredPlacement[]>([]);
 const token=useRef(accessToken);token.current=accessToken;const request=useRef(0),loadingMore=useRef(false);
 useEffect(()=>onStoryPublished(()=>setRetry(n=>n+1)),[]);
 // Your own Story's name and photo come from the feed: reload after an Edit Profile save.
 useEffect(()=>onProfileChanged(()=>setRetry(n=>n+1)),[]);
 // Returning from Profile/DM/overlays does not remount the viewer or restart its playback.
 useEffect(()=>{const generation=++request.current;const currentToken=token.current;if(!currentToken)return;setFeed(null);setCursor(null);setSponsored([]);setError('');setRefreshing(false);loadingMore.current=false;
  void getRankedHomeFeed(currentToken).then(result=>{if(generation!==request.current)return;setFeed(result.feed);setCursor(result.nextCursor);if(result.sponsoredEnabled)void getAdPlacements(result.feed.length,currentToken).then(r=>{if(generation===request.current)setSponsored(r.items);}).catch(()=>undefined);}).catch(()=>{if(generation===request.current)setError("Couldn't load Stories. Check your connection.");});
  return()=>{request.current++;};
 },[user?.id,retry]);
 const more=useCallback(()=>{if(!cursor||!token.current||loadingMore.current)return;loadingMore.current=true;const generation=request.current;
  void getRankedHomeFeed(token.current,cursor).then(result=>{if(generation!==request.current)return;setFeed(previous=>{const ids=new Set(previous?.map(e=>e.owner.id));return [...(previous??[]),...result.feed.filter(e=>!ids.has(e.owner.id))];});setCursor(result.nextCursor);setError('');}).catch(()=>{if(generation===request.current)setError('More Stories could not load. Retry or refresh your feed.');}).finally(()=>{if(generation===request.current)loadingMore.current=false;});
 },[cursor]);
 const refresh=()=>setRetry(n=>n+1);
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
 const creators=useMemo(()=>feed?.map(e=>e.owner.username)??[],[feed]);
 const following=useMemo(()=>Object.fromEntries((feed??[]).map(e=>[e.owner.username,e.isFollowing])),[feed]);
 // initial:false keeps Search's own first screen under the profile, so the Search tab still works after.
 const openDM=useCallback(({storyId,ownerUsername}:{storyId:string;ownerUsername:string})=>navigation.navigate('DM',{screen:'SendStory',initial:false,params:{storyId,ownerUsername}}),[navigation]);
 const openProfile=useCallback((username:string)=>navigation.navigate('Search',{screen:'UserProfile',initial:false,params:{username}}),[navigation]);
 if(feed===null&&!error)return <View style={styles.root}><StorySkeleton/>{activityButton}{uploads}</View>;
 if(feed===null)return <View style={styles.empty}>{activityButton}<Text style={typography.body}>{error||'Loading Stories…'}</Text>{error&&<Pressable onPress={refresh} accessibilityRole="button"><Text style={typography.body}>Try again</Text></Pressable>}</View>;
 // Pull down (or tap Refresh) to look again; Find people for someone to follow.
 if(!feed.length)return <View style={styles.root}><ScrollView contentContainerStyle={styles.emptyScroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadQuietly} tintColor={colors.textPrimary} colors={[colors.accent]}/>}>
  <EmptyState variant="media" title="No active Stories yet" message="Stories from people you follow and eligible new creators will appear here."/>
  <View style={styles.emptyActions}>
   <Pressable onPress={()=>navigation.navigate('Search',{screen:'SearchHome'})} style={styles.emptyButton} accessibilityRole="button"><Text style={styles.emptyButtonLabel}>Find people</Text></Pressable>
   <Pressable onPress={reloadQuietly} disabled={refreshing} style={styles.emptyButton} accessibilityRole="button" accessibilityLabel="Refresh Stories"><Text style={styles.emptyButtonLabel}>{refreshing?'Refreshing…':'Refresh'}</Text></Pressable>
  </View>
 </ScrollView>{activityButton}{uploads}</View>;
 return <View style={styles.root}><StoryFeed key={`${user?.id}:${retry}:${version}`} creators={creators} following={following} startIndex={0} sponsored={sponsored} onNeedMore={more} onRefresh={refresh}
  onOpenDM={openDM} onOpenProfile={openProfile}/>
  {!!error&&<View style={[styles.error,{top:insets.top+spacing.xl+40}]}><Text style={typography.caption}>{error}</Text><Pressable onPress={more} accessibilityRole="button"><Text style={typography.body}>Retry</Text></Pressable><Pressable onPress={refresh} accessibilityRole="button"><Text style={typography.body}>Refresh</Text></Pressable></View>}
  {activityButton}{uploads}
 </View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},activity:{position:'absolute',right:spacing.md,padding:spacing.xs,borderRadius:20,backgroundColor:'rgba(0,0,0,0.25)'},activityDot:{position:'absolute',top:4,right:4,width:9,height:9,borderRadius:5,backgroundColor:colors.accent,borderWidth:1.5,borderColor:colors.background},empty:{flex:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center'},error:{position:'absolute',left:16,right:16,padding:12,gap:8,backgroundColor:colors.surfaceElevated},emptyScroll:{flexGrow:1},emptyActions:{flexDirection:'row',justifyContent:'center',gap:spacing.md,paddingBottom:spacing.xxl*2},emptyButton:{paddingHorizontal:spacing.lg,paddingVertical:spacing.sm,borderRadius:20,borderWidth:1,borderColor:colors.textPrimary},emptyButtonLabel:{...typography.body,fontWeight:'700'}});
