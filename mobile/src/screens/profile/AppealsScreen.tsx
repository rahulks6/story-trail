import React,{useCallback,useState} from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { Pressable } from "../../components/Pressable";
import {apiPost} from '../../api/client';
import {ProviderEntry} from '../auth/ProviderEntry';
import {useHeaderHeight} from '@react-navigation/elements';
import {KeyboardAvoider} from '../../components/KeyboardAvoider';
import {colors} from '../../theme';
import {serverDate} from '../../utils/serverTime';
import { localeTag, t } from "../../i18n";
type Notice={actionId:string;action:string;reason:string;createdAt:string;appealStatus:string|null;
 /** Removals, restrictions and suspensions without an appeal yet (older servers omit this). */
 appealable?:boolean};
type Access={ticket:string;items:Notice[]};
export function AppealsScreen():React.JSX.Element {
 const headerHeight=useHeaderHeight();
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[access,setAccess]=useState<Access|null>(null),[selected,setSelected]=useState<string|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const verify=useCallback(async(payload:object)=>{const result=await apiPost<Access>('/api/v1/moderation/access',payload);setAccess(result);setPassword('');setError('');},[]);
 const provider=useCallback((proof:string)=>verify({proof}),[verify]);
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:t("appeals.couldNotLoadAccountNotices"));}finally{setBusy(false);}}
 const submit=()=>Alert.alert(t("appeals.submitAppeal2"),t("appeals.aModeratorWillReviewYour"),[{text:t("common.cancel"),style:'cancel'},{text:t("appeals.submit"),onPress:()=>void run(async()=>{await apiPost('/api/v1/moderation/appeal/submit',{ticket:access?.ticket,actionId:selected,reason});setAccess(null);setSelected(null);setReason('');Alert.alert(t("appeals.appealSubmitted"),t("appeals.verifyYourAccountAgainTo"));})}]);
 // Opaque header: the form starts below it.
 return <KeyboardAvoider style={styles.root} topOffset={headerHeight}><ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
  <Text style={styles.title}>{t("appeals.accountNoticesAndAppeals")}</Text>
  <Text style={styles.text}>{t("appeals.youCanRequestAReview")}</Text>
  {!access?<><TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder={t("common.email")} placeholderTextColor={colors.textSecondary} accessibilityLabel={t("common.email")}/><TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder={t("common.password")} placeholderTextColor={colors.textSecondary} accessibilityLabel={t("common.password")}/><Pressable accessibilityRole="button" style={styles.button} disabled={busy||!email||!password} onPress={()=>void run(()=>verify({email,password}))}><Text style={styles.text}>{t("appeals.viewNotices")}</Text></Pressable><ProviderEntry onProof={provider}/></>:<>
   {!access.items.length&&<Text style={styles.text}>{t("appeals.noModerationNoticesForThis")}</Text>}
   {access.items.map(n=><Pressable accessibilityRole="button" key={n.actionId} disabled={!!n.appealStatus||n.appealable===false} style={[styles.button,selected===n.actionId&&styles.selected]} onPress={()=>setSelected(n.actionId)}><Text style={styles.text}>{n.action.replace(/_/g,' ')} · {(serverDate(n.createdAt)?.toLocaleDateString(localeTag()) ?? "")}</Text><Text style={styles.text}>{n.reason}</Text><Text style={styles.text}>{n.appealStatus?(n.appealStatus==='UPHELD'?t("appeals.appealAccepted"):n.appealStatus==='DENIED'?t("appeals.appealDenied"):t("appeals.appealWaiting")):n.appealable===false?t("appeals.thisNoticeIsForYour"):t("appeals.tapToRequestAReview")}</Text></Pressable>)}
   {selected&&<><TextInput style={styles.input} multiline maxLength={1000} value={reason} onChangeText={setReason} placeholder={t("appeals.explainWhyThisDecisionShould")} placeholderTextColor={colors.textSecondary} accessibilityLabel={t("appeals.appealReason")}/><Pressable accessibilityRole="button" style={styles.button} disabled={busy||!reason.trim()} onPress={submit}><Text style={styles.text}>{t("appeals.submitAppeal")}</Text></Pressable></>}
   <Pressable accessibilityRole="button" style={styles.button} onPress={()=>{setAccess(null);setSelected(null);}}><Text style={styles.text}>{t("common.verifyAgain")}</Text></Pressable>
  </>}
  {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}</Text>}{busy&&<ActivityIndicator color={colors.accentText}/>}
 </ScrollView></KeyboardAvoider>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.background},fill:{flex:1},content:{padding:24,gap:16},title:{color:colors.textPrimary,fontSize:24,fontWeight:'700'},text:{color:colors.textPrimary},input:{padding:14,minHeight:48,borderWidth:1,borderColor:colors.border,color:colors.textPrimary,borderRadius:8},button:{padding:14,minHeight:48,backgroundColor:colors.surfaceElevated,borderRadius:8,gap:6},selected:{borderWidth:1,borderColor:colors.accentText},error:{color:colors.danger}});
