import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {useAuth} from '../../state/AuthContext';
import {listUploads,removeUpload,runUpload,subscribeUploads,uploadRunning,type UploadJob} from '../../state/uploadQueue';
import {colors} from '../../theme';
export function UploadQueueScreen():React.JSX.Element {
 const {user,accessToken}=useAuth();const [jobs,setJobs]=useState<UploadJob[]|null>(null),[error,setError]=useState('');
 const session=useRef<{ownerId:string;token:string}|null>(null);session.current=user&&accessToken?{ownerId:user.id,token:accessToken}:null;
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;session.current=null;};},[]);
 const refresh=useCallback(async()=>{if(!user)return;try{const next=await listUploads(user.id);if(mounted.current)setJobs(next);}catch{if(mounted.current)setError('Could not load saved uploads. Try again.');}},[user?.id]);
 useEffect(()=>{void refresh();return subscribeUploads(()=>void refresh());},[refresh]);
 const run=useCallback((job:UploadJob)=>{setError('');void runUpload(job.ownerId,job.id,()=>session.current).catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:'Upload failed.');});},[]);
 // Start one explicitly queued item at a time. Failed/interrupted items need a deliberate Retry.
 useEffect(()=>{if(!jobs||jobs.some(j=>uploadRunning(j.ownerId,j.id)))return;const next=jobs.find(j=>j.status==='queued');if(next)run(next);},[jobs,run]);
 const remove=(job:UploadJob)=>Alert.alert(job.status==='published'?'Dismiss receipt?':'Remove pending upload?',job.status==='published'?'The published Story will remain.':'This removes the saved local copy. Your original gallery file is unchanged.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void removeUpload(job.ownerId,job.id).catch(e=>setError(e.message))}]);
 return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
  <Text style={styles.title}>Story uploads</Text><Text style={styles.text}>Keep Katkee open while uploading. Saved uploads can be retried after restarting the app. Submitted edits are preserved with each upload.</Text>
  {jobs===null?<ActivityIndicator color={colors.accent}/>:!jobs.length?<Text style={styles.text}>No pending uploads.</Text>:jobs.map(job=>{const active=uploadRunning(job.ownerId,job.id);return <View key={job.id} style={styles.card}>
   <Text style={styles.text}>{job.payload.caption||'Story'} · {new Date(job.createdAt).toLocaleString()}</Text>
   <Text style={styles.text}>{active?job.status:job.status==='published'?'Published':job.status==='queued'?'Queued':'Waiting for retry'}</Text>
   {!!job.error&&<Text style={styles.error}>{job.error}</Text>}
   {active?<ActivityIndicator color={colors.accent}/>:<>{job.status!=='published'&&<Pressable style={styles.button} onPress={()=>run(job)} accessibilityRole="button"><Text style={styles.text}>Retry upload</Text></Pressable>}<Pressable style={styles.button} onPress={()=>remove(job)} accessibilityRole="button"><Text style={styles.text}>{job.status==='published'?'Dismiss':'Remove'}</Text></Pressable></>}
  </View>;})}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}<Pressable style={styles.button} onPress={()=>void refresh()}><Text style={styles.text}>Refresh</Text></Pressable>
 </ScrollView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},content:{padding:20,gap:16},title:{fontSize:24,fontWeight:'700',color:colors.textPrimary},text:{color:colors.textPrimary},error:{color:colors.danger},card:{padding:16,gap:10,borderRadius:12,backgroundColor:colors.surface},button:{minHeight:48,padding:14,backgroundColor:colors.surfaceElevated,borderRadius:8}});
