import React,{useCallback,useEffect,useRef,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {useNavigation,type CompositeNavigationProp} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {colors,typography} from '../../theme';
import {useAuth} from '../../state/AuthContext';
import {onStoryPublished} from '../../state/storyChanges';
import {getRankedHomeFeed,type RankedFeedEntry} from '../../api/stories';
import {EmptyState} from '../../components/EmptyState';
import {StoryFeed} from '../story/StoryFeed';
import {getAdPlacements,type SponsoredPlacement} from '../../api/ads';
import type {MainTabParamList,RootStackParamList} from '../../navigation/types';
type HomeNavigationProp=CompositeNavigationProp<BottomTabNavigationProp<MainTabParamList,'Home'>,NativeStackNavigationProp<RootStackParamList>>;
export function HomeScreen():React.JSX.Element {
 const {accessToken,user}=useAuth();const navigation=useNavigation<HomeNavigationProp>();
 const [feed,setFeed]=useState<RankedFeedEntry[]|null>(null),[retry,setRetry]=useState(0),[error,setError]=useState(''),[cursor,setCursor]=useState<string|null>(null),[sponsored,setSponsored]=useState<SponsoredPlacement[]>([]);
 const token=useRef(accessToken);token.current=accessToken;const request=useRef(0),loadingMore=useRef(false);
 useEffect(()=>onStoryPublished(()=>setRetry(n=>n+1)),[]);
 // Returning from Profile/DM/overlays does not remount the viewer or restart its playback.
 useEffect(()=>{const generation=++request.current;const currentToken=token.current;if(!currentToken)return;setFeed(null);setCursor(null);setSponsored([]);setError('');loadingMore.current=false;
  void getRankedHomeFeed(currentToken).then(result=>{if(generation!==request.current)return;setFeed(result.feed);setCursor(result.nextCursor);if(result.sponsoredEnabled)void getAdPlacements(result.feed.length,currentToken).then(r=>{if(generation===request.current)setSponsored(r.items);}).catch(()=>undefined);}).catch(()=>{if(generation===request.current)setError("Couldn't load Stories. Check your connection.");});
  return()=>{request.current++;};
 },[user?.id,retry]);
 const more=useCallback(()=>{if(!cursor||!token.current||loadingMore.current)return;loadingMore.current=true;const generation=request.current;
  void getRankedHomeFeed(token.current,cursor).then(result=>{if(generation!==request.current)return;setFeed(previous=>{const ids=new Set(previous?.map(e=>e.owner.id));return [...(previous??[]),...result.feed.filter(e=>!ids.has(e.owner.id))];});setCursor(result.nextCursor);setError('');}).catch(()=>{if(generation===request.current)setError('More Stories could not load. Retry or refresh your feed.');}).finally(()=>{if(generation===request.current)loadingMore.current=false;});
 },[cursor]);
 const refresh=()=>setRetry(n=>n+1);
 if(feed===null)return <View style={styles.empty}><Text style={typography.body}>{error||'Loading Stories…'}</Text>{error&&<Pressable onPress={refresh} accessibilityRole="button"><Text style={typography.body}>Try again</Text></Pressable>}</View>;
 if(!feed.length)return <EmptyState title="No active Stories yet" message="Stories from people you follow and eligible new creators will appear here."/>;
 return <View style={styles.root}><StoryFeed key={`${user?.id}:${retry}`} creators={feed.map(e=>e.owner.username)} startIndex={0} sponsored={sponsored} onNeedMore={more} onRefresh={refresh}
  onOpenDM={({storyId,ownerUsername})=>navigation.navigate('DM',{screen:'SendStory',params:{storyId,ownerUsername}})}
  onOpenProfile={username=>navigation.navigate('Search',{screen:'UserProfile',params:{username}})}/>
  {!!error&&<View style={styles.error}><Text style={typography.caption}>{error}</Text><Pressable onPress={more} accessibilityRole="button"><Text style={typography.body}>Retry</Text></Pressable><Pressable onPress={refresh} accessibilityRole="button"><Text style={typography.body}>Refresh</Text></Pressable></View>}
 </View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},empty:{flex:1,backgroundColor:colors.background,alignItems:'center',justifyContent:'center'},error:{position:'absolute',top:48,left:16,right:16,padding:12,gap:8,backgroundColor:colors.surfaceElevated}});
