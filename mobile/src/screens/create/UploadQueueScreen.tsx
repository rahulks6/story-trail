import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useAuth} from '../../state/AuthContext';
import {listUploads,needsNewFile,removeUpload,runUpload,subscribeUploads,uploadProgress,uploadRunning,type UploadJob} from '../../state/uploadQueue';
import {colors} from '../../theme';

/** What a person sees for each step: Preparing -> Uploading -> Processing -> Posted, or why it stopped. */
function describe(job:UploadJob,active:boolean,percent:number|undefined):string{
 switch(job.status){
  case 'queued':return 'Waiting to upload';
  case 'preparing':return active?'Preparing…':'Paused — tap Retry to continue';
  case 'uploading':return active?`Uploading ${percent===undefined?'':Math.round(percent*100)+'%'}`.trim():'Paused — tap Retry to continue';
  case 'publishing':return active?'Publishing…':'Paused — tap Retry to continue';
  case 'processing':return 'Processing — it will post automatically';
  case 'published':return 'Posted';
  case 'failed':return needsNewFile(job)?"Couldn't use this file":"Couldn't post";
 }
}

export function UploadQueueScreen():React.JSX.Element {
 const {user,accessToken}=useAuth();const [jobs,setJobs]=useState<UploadJob[]|null>(null),[error,setError]=useState('');
 const [,setTick]=useState(0);
 const session=useRef<{ownerId:string;token:string}|null>(null);session.current=user&&accessToken?{ownerId:user.id,token:accessToken}:null;
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;session.current=null;};},[]);
 const refresh=useCallback(async()=>{if(!user)return;try{const next=await listUploads(user.id);if(mounted.current){setJobs(next);setTick(t=>t+1);}}catch{if(mounted.current)setError('Could not load saved uploads. Try again.');}},[user?.id]);
 useEffect(()=>{void refresh();return subscribeUploads(()=>void refresh());},[refresh]);
 const run=useCallback((job:UploadJob)=>{setError('');void runUpload(job.ownerId,job.id,()=>session.current).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:'Upload failed.');});},[]);
 // One upload at a time; Stories already on the server just get checked on. Failed or
 // interrupted items wait for a deliberate Retry.
 useEffect(()=>{
  if(!jobs)return;
  for(const job of jobs)if(job.status==='processing'&&!uploadRunning(job.ownerId,job.id))run(job);
  if(jobs.some(j=>j.status!=='processing'&&uploadRunning(j.ownerId,j.id)))return;
  const next=jobs.find(j=>j.status==='queued');if(next)run(next);
 },[jobs,run]);
 const remove=(job:UploadJob)=>Alert.alert(job.status==='published'?'Dismiss receipt?':'Remove this Story?',job.status==='published'?'The posted Story stays up.':'This removes the saved copy and your edits. Your original photo or video is unchanged.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void removeUpload(job.ownerId,job.id).catch(e=>setError(e.message))}]);
 return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
  <Text style={styles.title} accessibilityRole="header">Story uploads</Text>
  <Text style={styles.muted}>Keep Katkee open while a Story uploads. Once it's processing, it posts automatically — you can close the app. Saved uploads continue where they stopped.</Text>
  {jobs===null?<ActivityIndicator color={colors.accent}/>:!jobs.length?<Text style={styles.muted}>No pending uploads.</Text>:jobs.map(job=>{
   const active=uploadRunning(job.ownerId,job.id);const percent=uploadProgress(job.ownerId,job.id);
   const label=describe(job,active,percent);
   const canRetry=!active&&job.status!=='published'&&job.status!=='queued'&&job.status!=='processing'&&!needsNewFile(job);
   return <View key={job.id} style={styles.card}>
    <Text style={styles.text} numberOfLines={2}>{job.payload.caption||(job.kind==='video'?'Video Story':'Photo Story')} · {new Date(job.createdAt).toLocaleString()}</Text>
    <Text style={[styles.status,job.status==='failed'&&styles.error,job.status==='published'&&styles.done]} accessibilityLiveRegion="polite">{label}</Text>
    {job.status==='uploading'&&active?<View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{min:0,max:100,now:Math.round((percent??0)*100)}}><View style={[styles.fill,{width:`${Math.round((percent??0)*100)}%`}]}/></View>:null}
    {!!job.error&&job.status==='failed'&&<Text style={styles.error}>{job.error}</Text>}
    {needsNewFile(job)&&<Text style={styles.muted}>Remove it and share the photo or video again, or choose a different one.</Text>}
    {active&&job.status!=='uploading'?<ActivityIndicator color={colors.accent}/>:null}
    <View style={styles.actions}>
     {canRetry&&<Pressable style={styles.button} onPress={()=>run(job)} accessibilityRole="button"><Text style={styles.text}>Retry</Text></Pressable>}
     {!active&&<Pressable style={styles.button} onPress={()=>remove(job)} accessibilityRole="button"><Text style={styles.text}>{job.status==='published'?'Dismiss':'Remove'}</Text></Pressable>}
    </View>
   </View>;})}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  <Pressable style={styles.button} onPress={()=>void refresh()} accessibilityRole="button"><Text style={styles.text}>Refresh</Text></Pressable>
 </ScrollView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},content:{padding:20,gap:16},title:{fontSize:24,fontWeight:'700',color:colors.textPrimary},text:{color:colors.textPrimary},muted:{color:colors.textSecondary},status:{color:colors.textPrimary,fontWeight:'600'},done:{color:colors.accent},error:{color:colors.danger},card:{padding:16,gap:10,borderRadius:12,backgroundColor:colors.surface},track:{height:6,borderRadius:3,backgroundColor:colors.surfaceElevated,overflow:'hidden'},fill:{height:6,backgroundColor:colors.accent},actions:{flexDirection:'row',gap:10},button:{minHeight:48,paddingHorizontal:16,justifyContent:'center',backgroundColor:colors.surfaceElevated,borderRadius:8}});
