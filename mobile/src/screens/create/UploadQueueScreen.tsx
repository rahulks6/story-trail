import React,{useCallback,useEffect,useRef,useState} from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import {useAuth} from '../../state/AuthContext';
import {autoResumeDue,cancelUpload,isDone,listUploads,needsNewFile,removeUpload,runUpload,subscribeUploads,uploadProgress,uploadRunning,type UploadJob} from '../../state/uploadQueue';
import {colors} from '../../theme';
import {serverDate} from '../../utils/serverTime';
import {scheduleText} from '../../models/schedule';
import { t } from "../../i18n";

/** What a person sees for each step: Preparing -> Uploading -> Processing -> Posted, or why it stopped. */
function describe(job:UploadJob,active:boolean,percent:number|undefined):string{
 switch(job.status){
  case 'queued':return t("uploadQueue.waitingToUpload");
  case 'preparing':return active?t("uploadQueue.preparing"):t("uploadQueue.pausedTapRetryToContinue");
  case 'uploading':return active?`Uploading ${percent===undefined?'':Math.round(percent*100)+'%'}`.trim():t("uploadQueue.pausedTapRetryToContinue");
  case 'publishing':return active?t("uploadQueue.publishing"):t("uploadQueue.pausedTapRetryToContinue");
  case 'processing':return t("uploadQueue.processingItWillPostAutomatically");
  case 'published':return t("uploadQueue.posted");
  case 'scheduled':return serverDate(job.payload.publishAt)?t("uploadQueue.scheduledForPublishat", { publishAt: scheduleText(serverDate(job.payload.publishAt)!) }):t("common.scheduled");
  case 'failed':return needsNewFile(job)?t("uploadQueue.couldntUseThisFile"):autoResumeDue(job,Number.POSITIVE_INFINITY)?t("uploadQueue.couldntConnectTryingAgainSoon"):t("uploadQueue.couldntPost");
 }
}

export function UploadQueueScreen():React.JSX.Element {
 const {user,accessToken}=useAuth();const [jobs,setJobs]=useState<UploadJob[]|null>(null),[error,setError]=useState('');
 const [,setTick]=useState(0);
 const session=useRef<{ownerId:string;token:string}|null>(null);session.current=user&&accessToken?{ownerId:user.id,token:accessToken}:null;
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;session.current=null;};},[]);
 const refresh=useCallback(async()=>{if(!user)return;try{const next=await listUploads(user.id);if(mounted.current){setJobs(next);setTick(item=>item+1);}}catch{if(mounted.current)setError(t("uploadQueue.couldNotLoadSavedUploads"));}},[user?.id]);
 useEffect(()=>{void refresh();return subscribeUploads(()=>void refresh());},[refresh]);
 const run=useCallback((job:UploadJob)=>{setError('');void runUpload(job.ownerId,job.id,()=>session.current).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:t("uploadQueue.uploadFailed"));});},[]);
 // Uploads run in the background (state/UploadRunner); failed or interrupted ones wait here for a Retry.
 // A Story not yet posted may already be on the server: cancel it there too, or it would still post.
 const discard=async(job:UploadJob)=>{
  if(isDone(job)){await removeUpload(job.ownerId,job.id);return;}
  if(!await cancelUpload(job.ownerId,job.id,session.current?.token??null)&&mounted.current)setError(t("uploadQueue.itPostedJustNowOpen"));
 };
 const remove=(job:UploadJob)=>Alert.alert(isDone(job)?t("uploadQueue.dismissReceipt"):t("uploadQueue.removeThisStory"),job.status==='scheduled'?t("uploadQueue.itStillPostsAtIts"):job.status==='published'?t("uploadQueue.thePostedStoryStaysUp"):t("uploadQueue.thisRemovesTheSavedCopy"),[{text:t("common.cancel"),style:'cancel'},{text:t("common.remove"),style:'destructive',onPress:()=>void discard(job).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:t("uploadQueue.couldNotRemoveItTry"));})}]);
 return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
  <Text style={styles.title} accessibilityRole="header">{t("common.storyUploads")}</Text>
  <Text style={styles.muted}>{t("uploadQueue.storiesShareInTheBackground")}</Text>
  {jobs===null?<ActivityIndicator color={colors.accentText}/>:!jobs.length?<Text style={styles.muted}>{t("uploadQueue.noPendingUploads")}</Text>:jobs.map(job=>{
   const active=uploadRunning(job.ownerId,job.id);const percent=uploadProgress(job.ownerId,job.id);
   const label=describe(job,active,percent);
   const canRetry=!active&&!isDone(job)&&job.status!=='queued'&&job.status!=='processing'&&!needsNewFile(job);
   return <View key={job.id} style={styles.card}>
    <Text style={styles.text} numberOfLines={2}>{job.payload.caption||(job.kind==='video'?t("uploadQueue.videoStory"):t("uploadQueue.photoStory"))} · {serverDate(job.createdAt)?.toLocaleString() ?? ''}</Text>
    <Text style={[styles.status,job.status==='failed'&&styles.error,isDone(job)&&styles.done]} accessibilityLiveRegion="polite">{label}</Text>
    {job.status==='uploading'&&active?<View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{min:0,max:100,now:Math.round((percent??0)*100)}}><View style={[styles.fill,{width:`${Math.round((percent??0)*100)}%`}]}/></View>:null}
    {!!job.error&&job.status==='failed'&&<Text style={styles.error}>{job.error}</Text>}
    {needsNewFile(job)&&<Text style={styles.muted}>{t("uploadQueue.removeItAndShareThe")}</Text>}
    {active&&job.status!=='uploading'?<ActivityIndicator color={colors.accentText}/>:null}
    <View style={styles.actions}>
     {canRetry&&<Pressable style={styles.button} onPress={()=>run(job)} accessibilityRole="button"><Text style={styles.text}>{t("common.retry")}</Text></Pressable>}
     {!active&&!job.cancelAfterPublish&&<Pressable style={styles.button} onPress={()=>remove(job)} accessibilityRole="button"><Text style={styles.text}>{isDone(job)?t("uploadQueue.dismiss"):t("common.remove")}</Text></Pressable>}
    </View>
   </View>;})}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  <Pressable style={styles.button} onPress={()=>void refresh()} accessibilityRole="button"><Text style={styles.text}>{t("common.refresh")}</Text></Pressable>
 </ScrollView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},content:{padding:20,gap:16},title:{fontSize:24,fontWeight:'700',color:colors.textPrimary},text:{color:colors.textPrimary},muted:{color:colors.textSecondary},status:{color:colors.textPrimary,fontWeight:'600'},done:{color:colors.accentText},error:{color:colors.danger},card:{padding:16,gap:10,borderRadius:12,backgroundColor:colors.surface},track:{height:6,borderRadius:3,backgroundColor:colors.surfaceElevated,overflow:'hidden'},fill:{height:6,backgroundColor:colors.accent},actions:{flexDirection:'row',gap:10},button:{minHeight:48,paddingHorizontal:16,justifyContent:'center',backgroundColor:colors.surfaceElevated,borderRadius:8}});
