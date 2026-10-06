import React,{useCallback,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,TextInput} from 'react-native';
import {apiPost} from '../../api/client';
import {ProviderEntry} from '../auth/ProviderEntry';
import {useHeaderHeight} from '@react-navigation/elements';
import {KeyboardAvoider} from '../../components/KeyboardAvoider';
import {colors} from '../../theme';
import {serverDate} from '../../utils/serverTime';
type Notice={actionId:string;action:string;reason:string;createdAt:string;appealStatus:string|null;
 /** Removals, restrictions and suspensions without an appeal yet (older servers omit this). */
 appealable?:boolean};
type Access={ticket:string;items:Notice[]};
export function AppealsScreen():React.JSX.Element {
 const headerHeight=useHeaderHeight();
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[access,setAccess]=useState<Access|null>(null),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const verify=useCallback(async(payload:object)=>{const result=await apiPost<Access>('/api/v1/moderation/access',payload);setAccess(result);setPassword('');setError('');},[]);
 const provider=useCallback((proof:string)=>verify({proof}),[verify]);
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Could not load account notices.');}finally{setBusy(false);}}
 const submit=()=>Alert.alert('Submit appeal?','A moderator will review your explanation. Submitting does not automatically restore content or account access.',[{text:'Cancel',style:'cancel'},{text:'Submit',onPress:()=>void run(async()=>{await apiPost('/api/v1/moderation/appeal/submit',{ticket:access?.ticket,actionId:selected,reason});setAccess(null);setSelected(null);setReason('');Alert.alert('Appeal submitted','Verify your account again to check its status.');})}]);
 // Opaque header: the form starts below it.
 return <KeyboardAvoider style={styles.root} topOffset={headerHeight}><ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <Text style={styles.title}>Account notices and appeals</Text>
  <Text style={styles.text}>You can request a review even if your account is suspended. Verify an existing sign-in method to view your notices.</Text>
  {!access?<><TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.textSecondary} accessibilityLabel="Email"/><TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor={colors.textSecondary} accessibilityLabel="Password"/><Pressable style={styles.button} disabled={busy||!email||!password} onPress={()=>void run(()=>verify({email,password}))}><Text style={styles.text}>View notices</Text></Pressable><ProviderEntry onProof={provider}/></>:<>
   {!access.items.length&&<Text style={styles.text}>No moderation notices for this account.</Text>}
   {access.items.map(n=><Pressable key={n.actionId} disabled={!!n.appealStatus||n.appealable===false} style={[styles.button,selected===n.actionId&&styles.selected]} onPress={()=>setSelected(n.actionId)}><Text style={styles.text}>{n.action.replace(/_/g,' ')} · {(serverDate(n.createdAt)?.toLocaleDateString() ?? "")}</Text><Text style={styles.text}>{n.reason}</Text><Text style={styles.text}>{n.appealStatus?'Appeal: '+(n.appealStatus==='UPHELD'?'accepted — the decision was reversed':n.appealStatus==='DENIED'?'reviewed — the decision stands':'waiting for review'):n.appealable===false?'This notice is for your information':'Tap to request a review'}</Text></Pressable>)}
   {selected&&<><TextInput style={styles.input} multiline maxLength={1000} value={reason} onChangeText={setReason} placeholder="Explain why this decision should be reviewed" placeholderTextColor={colors.textSecondary} accessibilityLabel="Appeal reason"/><Pressable style={styles.button} disabled={busy||!reason.trim()} onPress={submit}><Text style={styles.text}>Submit appeal</Text></Pressable></>}
   <Pressable style={styles.button} onPress={()=>{setAccess(null);setSelected(null);}}><Text style={styles.text}>Verify again</Text></Pressable>
  </>}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{busy&&<ActivityIndicator color={colors.accent}/>}
 </ScrollView></KeyboardAvoider>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},fill:{flex:1},content:{padding:24,gap:16},title:{color:colors.textPrimary,fontSize:24,fontWeight:'700'},text:{color:colors.textPrimary},input:{padding:14,minHeight:48,borderWidth:1,borderColor:colors.border,color:colors.textPrimary,borderRadius:8},button:{padding:14,minHeight:48,backgroundColor:colors.surfaceElevated,borderRadius:8,gap:6},selected:{borderWidth:1,borderColor:colors.accent},error:{color:colors.danger}});
