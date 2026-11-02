import React,{useCallback,useEffect,useState} from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import {apiGet,apiPost} from '../../api/client';
import {ProviderEntry} from '../auth/ProviderEntry';
import {useHeaderHeight} from '@react-navigation/elements';
import {KeyboardAvoider} from '../../components/KeyboardAvoider';
import {useAuth} from '../../state/AuthContext';
import {colors} from '../../theme';
import {SignInSecuritySection} from './SignInSecuritySection';
import { t } from "../../i18n";
interface Identities {items:Array<{provider:'GOOGLE'|'APPLE'|'PHONE';verified_at:string}>;hasPassword:boolean}
export function AccountSecurityScreen():React.JSX.Element {
 const headerHeight=useHeaderHeight();
 const {accessToken,logout}=useAuth();const [identities,setIdentities]=useState<Identities|null>(null),[password,setPassword]=useState(''),[ticket,setTicket]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(accessToken)void apiGet<Identities>('/api/v1/auth/identities',accessToken).then(setIdentities).catch(e=>setError(e.message));},[accessToken]);
 const verifyProvider=useCallback(async(proof:string)=>{if(!accessToken)return;const result=await apiPost<{reauthTicket:string}>('/api/v1/auth/provider/reauthenticate',{proof},accessToken);setTicket(result.reauthTicket);setError('');},[accessToken]);
 const linkProvider=useCallback(async(proof:string)=>{if(!accessToken||!ticket)return;
  const confirmed=await new Promise<boolean>(resolve=>Alert.alert(t("accountSecurity.linkThisSignInMethod"),t("accountSecurity.theVerifiedProviderWillGrant"),[{text:t("common.cancel"),style:'cancel',onPress:()=>resolve(false)},{text:t("accountSecurity.linkMethod"),onPress:()=>resolve(true)}],{cancelable:true,onDismiss:()=>resolve(false)}));
  if(!confirmed)return;
  await apiPost('/api/v1/auth/provider/link',{proof,reauthTicket:ticket,confirmed:true},accessToken);Alert.alert(t("accountSecurity.signInMethodLinked"),t("accountSecurity.signInAgainUsingYour"));await logout();},[accessToken,ticket,logout]);
 async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:t("accountSecurity.accountChangeFailed"));}finally{setBusy(false);}}
 const change=(provider:string)=>Alert.alert(t("accountSecurity.unlinkProviderQuestion",{provider}),t("accountSecurity.youMustKeepAnotherUsable"),[{text:t("common.cancel"),style:'cancel'},{text:t("accountSecurity.unlink"),style:'destructive',onPress:()=>void run(async()=>{await apiPost('/api/v1/auth/provider/unlink',{provider,reauthTicket:ticket,confirmed:true},accessToken??undefined);await logout();})}]);
 const remove=()=>Alert.alert(t("accountSecurity.deleteYourKatkeeAccount"),t("accountSecurity.yourAccountAndPublicContent"),[{text:t("common.cancel"),style:'cancel'},{text:t("common.deleteAccount"),style:'destructive',onPress:()=>void run(async()=>{await apiPost('/api/v1/auth/account/delete',{reauthTicket:ticket,confirmed:true},accessToken??undefined);await logout();})}]);
 // Opaque header: the form starts below it.
 return <KeyboardAvoider style={styles.root} topOffset={headerHeight}><ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  {identities?<SignInSecuritySection hasPassword={identities.hasPassword}/>:null}
  <Text style={styles.title}>{t("accountSecurity.signInMethods")}</Text>
  {identities?<Text style={styles.text}>{[...(identities.hasPassword?[t("accountSecurity.emailAndPassword")]:[]),...identities.items.map(i=>i.provider)].join(', ')||t("accountSecurity.noLinkedProvider")}</Text>:<ActivityIndicator color={colors.accentText}/>}
  {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  {!ticket?<>
   <Text style={styles.text}>{t("accountSecurity.verifyYourExistingSignIn")}</Text>
   {identities?.hasPassword&&<><TextInput style={styles.input} accessibilityLabel={t("common.currentPassword")} secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} placeholder={t("common.currentPassword")} placeholderTextColor={colors.textSecondary}/><Pressable accessibilityRole="button" disabled={busy||!password} style={styles.button} onPress={()=>void run(async()=>{const result=await apiPost<{reauthTicket:string}>('/api/v1/auth/reauthenticate',{password},accessToken??undefined);setPassword('');setTicket(result.reauthTicket);})}><Text style={styles.text}>{t("accountSecurity.verifyPassword")}</Text></Pressable></>}
   <ProviderEntry onProof={verifyProvider}/>
  </>:<>
   <Text style={styles.text}>{t("accountSecurity.verifiedForFiveMinutesLink")}</Text>
   <ProviderEntry onProof={linkProvider}/>
   {identities?.items.map(i=><Pressable accessibilityRole="button" key={i.provider} disabled={busy} style={styles.button} onPress={()=>change(i.provider)}><Text style={styles.text}>{t("accountSecurity.unlinkProvider", { provider: i.provider })}</Text></Pressable>)}
   <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={remove}><Text style={styles.error}>{t("common.deleteAccount")}</Text></Pressable>
   <Pressable accessibilityRole="button" style={styles.button} onPress={()=>setTicket(null)}><Text style={styles.text}>{t("common.verifyAgain")}</Text></Pressable>
  </>}
  {busy&&<ActivityIndicator color={colors.accentText}/>}
 </ScrollView></KeyboardAvoider>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},fill:{flex:1},content:{padding:24,gap:16},title:{fontSize:24,fontWeight:'700',color:colors.textPrimary},text:{color:colors.textPrimary},error:{color:colors.danger},input:{borderWidth:1,borderColor:colors.border,padding:14,minHeight:48,color:colors.textPrimary},button:{minHeight:48,padding:14,backgroundColor:colors.surfaceElevated,borderRadius:8}});
