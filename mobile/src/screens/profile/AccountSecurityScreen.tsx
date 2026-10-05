import React,{useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {apiGet,apiPost} from '../../api/client';
import {ProviderEntry} from '../auth/ProviderEntry';
import {useAuth} from '../../state/AuthContext';
import {colors} from '../../theme';
interface Identities {items:Array<{provider:'GOOGLE'|'PHONE';verified_at:string}>;hasPassword:boolean}
export function AccountSecurityScreen():React.JSX.Element {
 const {accessToken,logout}=useAuth();const [identities,setIdentities]=useState<Identities|null>(null),[password,setPassword]=useState(''),[ticket,setTicket]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(accessToken)void apiGet<Identities>('/api/v1/auth/identities',accessToken).then(setIdentities).catch(e=>setError(e.message));},[accessToken]);
 const verifyProvider=useCallback(async(proof:string)=>{if(!accessToken)return;const result=await apiPost<{reauthTicket:string}>('/api/v1/auth/provider/reauthenticate',{proof},accessToken);setTicket(result.reauthTicket);setError('');},[accessToken]);
 const linkProvider=useCallback(async(proof:string)=>{if(!accessToken||!ticket)return;
  const confirmed=await new Promise<boolean>(resolve=>Alert.alert('Link this sign-in method?','The verified provider will grant access to this Katkee account. You will be signed out after linking.',[{text:'Cancel',style:'cancel',onPress:()=>resolve(false)},{text:'Link method',onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
  if(!confirmed)return;
  await apiPost('/api/v1/auth/provider/link',{proof,reauthTicket:ticket,confirmed:true},accessToken);Alert.alert('Sign-in method linked','Sign in again using your existing or newly linked method.');await logout();},[accessToken,ticket,logout]);
 async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Account change failed.');}finally{setBusy(false);}}
 const change=(provider:string)=>Alert.alert('Unlink '+provider+'?','You must keep another usable sign-in method. You will be signed out.',[{text:'Cancel',style:'cancel'},{text:'Unlink',style:'destructive',onPress:()=>void run(async()=>{await apiPost('/api/v1/auth/provider/unlink',{provider,reauthTicket:ticket,confirmed:true},accessToken??undefined);await logout();})}]);
 const remove=()=>Alert.alert('Delete your Katkee account?','Your account and public content will become unavailable. This cannot be undone from the app.',[{text:'Cancel',style:'cancel'},{text:'Delete account',style:'destructive',onPress:()=>void run(async()=>{await apiPost('/api/v1/auth/account/delete',{reauthTicket:ticket,confirmed:true},accessToken??undefined);await logout();})}]);
 return <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <Text style={styles.title}>Sign-in methods</Text>
  {identities?<Text style={styles.text}>{[...(identities.hasPassword?['Email and password']:[]),...identities.items.map(i=>i.provider)].join(', ')||'No linked provider'}</Text>:<ActivityIndicator color={colors.accent}/>}
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  {!ticket?<>
   <Text style={styles.text}>Verify your existing sign-in method before changing account access.</Text>
   {identities?.hasPassword&&<><TextInput style={styles.input} accessibilityLabel="Current password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} placeholder="Current password" placeholderTextColor={colors.textSecondary}/><Pressable disabled={busy||!password} style={styles.button} onPress={()=>void run(async()=>{const result=await apiPost<{reauthTicket:string}>('/api/v1/auth/reauthenticate',{password},accessToken??undefined);setPassword('');setTicket(result.reauthTicket);})}><Text style={styles.text}>Verify password</Text></Pressable></>}
   <ProviderEntry onProof={verifyProvider}/>
  </>:<>
   <Text style={styles.text}>Verified for five minutes. Link a new provider below; its ownership will be verified before linking. Existing Katkee data stays on this account.</Text>
   <ProviderEntry onProof={linkProvider}/>
   {identities?.items.map(i=><Pressable key={i.provider} disabled={busy} style={styles.button} onPress={()=>change(i.provider)}><Text style={styles.text}>Unlink {i.provider}</Text></Pressable>)}
   <Pressable disabled={busy} style={styles.button} onPress={remove}><Text style={styles.error}>Delete account</Text></Pressable>
   <Pressable style={styles.button} onPress={()=>setTicket(null)}><Text style={styles.text}>Verify again</Text></Pressable>
  </>}
  {busy&&<ActivityIndicator color={colors.accent}/>}
 </ScrollView>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},content:{padding:24,gap:16},title:{fontSize:24,fontWeight:'700',color:colors.textPrimary},text:{color:colors.textPrimary},error:{color:colors.danger},input:{borderWidth:1,borderColor:colors.border,padding:14,minHeight:48,color:colors.textPrimary},button:{minHeight:48,padding:14,backgroundColor:colors.surfaceElevated,borderRadius:8}});
