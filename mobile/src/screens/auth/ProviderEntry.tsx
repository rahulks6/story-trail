import {useSafeAreaInsets} from 'react-native-safe-area-context';
﻿import React,{useEffect,useState} from 'react';
import { ActivityIndicator, Alert, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import {GoogleSignin,GoogleSigninButton,isSuccessResponse,isErrorWithCode,statusCodes} from '@react-native-google-signin/google-signin';
import {AppleButton,appleAuth} from '@invertase/react-native-apple-authentication';
import * as Keychain from 'react-native-keychain';
import * as api from '../../api/providers';
import {providerBuild} from '../../config/providers';
import {useAuth} from '../../state/AuthContext';
import {colors,colorScheme,FORM_MAX_WIDTH} from '../../theme';
import {KeyboardAvoider} from '../../components/KeyboardAvoider';
import {usernameCheckText,usernameRefused,useUsernameAvailability} from '../../hooks/useUsernameAvailability';
import {hasTickLikeCharacter,nameTickError} from '../../api/verification';
import {TermsNotice} from '../../components/TermsNotice';
import {BIRTH_DATE_MESSAGES,birthDateFieldProblem,birthDateProblem,birthDateToIso,formatBirthDateInput} from '../../utils/birthDate';
import { t } from "../../i18n";
/**
 * Google shows only where this build can finish it: iOS needs its own client ID and, for App
 * Review 4.8, Sign in with Apple offered beside it (showGoogle below).
 */
const googleReady=!!providerBuild.googleWebClientId&&(Platform.OS!=='ios'||!!providerBuild.googleIosClientId);
const PENDING_SERVICE='com.katkee.provider-onboarding.v1';
export function ProviderEntry({onProof}:{onProof?:(proof:string)=>Promise<void>}):React.JSX.Element {
 // Full-screen modals draw under both system bars (edge-to-edge): pad by the real insets.
 const insets=useSafeAreaInsets();
 const {acceptSession}=useAuth();const [methods,setMethods]=useState<api.AuthMethods|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [stage,setStage]=useState<'closed'|'phone'|'code'|'username'>('closed');const [country,setCountry]=useState(''),[phone,setPhone]=useState(''),[code,setCode]=useState('');
 const [challenge,setChallenge]=useState<api.PhoneChallenge|null>(null),[resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
 const [proof,setProof]=useState(''),[username,setUsername]=useState(''),[name,setName]=useState(''),[birth,setBirth]=useState('');
 // Katkee is for people 18 and older; the server checks again (backend/src/modules/auth/age.ts).
 const birthDate=birthDateToIso(birth),birthProblem=birthDateFieldProblem(birth);
 const availability=useUsernameAvailability(stage==='username'?username:'',null),availabilityLine=usernameCheckText(availability);
 useEffect(()=>{let alive=true;void api.methods().then(m=>{if(alive){setMethods(m);setCountry(m.countries[0]??'');}}).catch(()=>{if(alive)setError(t("providerEntry.additionalSignInMethodsAre"));});
  if(!onProof)void Keychain.getGenericPassword({service:PENDING_SERVICE}).then(c=>{if(c&&alive){const p=JSON.parse(c.password);if(p.expiresAt>Date.now()){setProof(p.proof);setName(typeof p.name==='string'?p.name:'');setStage('username');}else void Keychain.resetGenericPassword({service:PENDING_SERVICE});}}).catch(()=>undefined);
  return()=>{alive=false;};},[onProof]);
 useEffect(()=>{if(stage!=='code')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[stage]);
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:t("providerEntry.unableToSignInTry"));}finally{setBusy(false);}}
 async function accept(result:api.ProviderResult,suggestedName=''){
  if('tokens' in result){await acceptSession(result);await Keychain.resetGenericPassword({service:PENDING_SERVICE});setStage('closed');return;}
  if(onProof){await onProof(result.proof);setStage('closed');return;}
  // A suggested name (Apple's, which it sends only once) is kept with the pending sign-up.
  const saved=await Keychain.setGenericPassword('onboarding',JSON.stringify({proof:result.proof,expiresAt:Date.now()+result.expiresIn*1000,name:suggestedName}),{service:PENDING_SERVICE,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
  if(!saved)throw Error(t("providerEntry.secureStorageUnavailablePleaseTry"));setProof(result.proof);setName(suggestedName);setStage('username');
 }
 const google=()=>run(async()=>{
  if(!providerBuild.googleWebClientId)throw Error(t("providerEntry.googleSignInHasNot"));
  GoogleSignin.configure({webClientId:providerBuild.googleWebClientId,...(providerBuild.googleIosClientId?{iosClientId:providerBuild.googleIosClientId}:{}),offlineAccess:false});
  try{await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog:true});const response=await GoogleSignin.signIn();if(!isSuccessResponse(response))return;if(!response.data.idToken)throw Error(t("providerEntry.googleDidNotReturnA"));await accept(await api.google(response.data.idToken,!!onProof));}
  catch(e){if(isErrorWithCode(e)&&e.code===statusCodes.SIGN_IN_CANCELLED)return;throw e;}
 });
 // The server's nonce goes to Apple (the library sends its SHA-256), which signs it into the token.
 const apple=()=>run(async()=>{
  const {nonce}=await api.appleNonce();
  let response;
  try{response=await appleAuth.performRequest({requestedOperation:appleAuth.Operation.LOGIN,requestedScopes:[appleAuth.Scope.FULL_NAME,appleAuth.Scope.EMAIL],nonce});}
  catch(e){if((e as {code?:string}|null)?.code===appleAuth.Error.CANCELED)return;throw e;}
  if(!response.identityToken||!response.authorizationCode)throw Error(t("providerEntry.appleDidNotReturnA"));
  // Apple shares the person's name only the first time they use it with Katkee: offered as the display name.
  const fullName=Array.from([response.fullName?.givenName,response.fullName?.familyName].filter(Boolean).join(' ').trim()).slice(0,60).join('');
  await accept(await api.apple(response.identityToken,response.authorizationCode,!!onProof),fullName);
 });
 const send=()=>run(async()=>{const result=await api.requestPhone(phone,country);setChallenge(result);setCode('');setResendAt(Date.now()+result.resendAfter*1000);setNow(Date.now());setStage('code');});
 const confirmSend=()=>Alert.alert(t("providerEntry.sendVerificationCode"),t("providerEntry.sendAnSmsToCountry", { country, value: phone.replace(/\D/g,'').slice(-4) }),[{text:t("common.cancel"),style:'cancel'},{text:t("common.sendCode"),onPress:()=>void send()}]);
 const close=()=>{if(busy)return;setStage('closed');setError('');setCode('');};
 // The server refuses someone under 18 and deletes their verified sign-in, so this one is over.
 const finish=()=>run(async()=>{try{await accept(await api.complete(proof,username,name,birthDate!));}catch(e){if(e instanceof Error&&e.message===BIRTH_DATE_MESSAGES.tooYoung){await Keychain.resetGenericPassword({service:PENDING_SERVICE});setProof('');setStage('closed');}throw e;}});
 // Apple's own button, as prominent as Google's and above it (Human Interface Guidelines). iPhone
 // only: Android doesn't link the library (react-native.config.js).
 const showApple=!!methods?.apple&&Platform.OS==='ios'&&appleAuth.isSupported;
 const showGoogle=!!methods?.google&&googleReady&&(Platform.OS!=='ios'||showApple);
 return <View>
  {showApple&&<AppleButton style={styles.apple} cornerRadius={8} buttonStyle={colorScheme()==='dark'?AppleButton.Style.WHITE:AppleButton.Style.BLACK} buttonType={AppleButton.Type.CONTINUE} onPress={()=>void apple()}/>}
  {showGoogle&&<GoogleSigninButton style={styles.google} size={GoogleSigninButton.Size.Wide} color={GoogleSigninButton.Color.Dark} disabled={busy} onPress={()=>void google()}/>}
  {methods?.phone&&<Pressable style={styles.button} disabled={busy} accessibilityRole="button" onPress={()=>{setError('');setStage('phone');}}><Text style={styles.buttonText}>{t("providerEntry.continueWithPhone")}</Text></Pressable>}
  {stage==='closed'&&error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  <Modal visible={stage!=='closed'} animationType="slide" onRequestClose={close}>
   <KeyboardAvoider style={styles.fill}><ScrollView contentContainerStyle={[styles.modal,{paddingTop:insets.top+24,paddingBottom:insets.bottom+24}]} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>{stage==='username'?t("common.createYourAccount"):stage==='code'?t("providerEntry.enterVerificationCode"):t("providerEntry.continueWithPhone")}</Text>
    {stage==='phone'&&<><Text style={styles.label}>{t("providerEntry.countryRegion")}</Text><View style={styles.countries}>{methods?.countries.map(c=><Pressable key={c} accessibilityRole="button" accessibilityState={{selected:country===c}} onPress={()=>setCountry(c)} style={[styles.country,country===c&&styles.selected]}><Text style={styles.label}>{c}</Text></Pressable>)}</View><TextInput style={styles.input} accessibilityLabel={t("providerEntry.mobileNumber")} keyboardType="phone-pad" textContentType="telephoneNumber" value={phone} onChangeText={setPhone} placeholder={t("providerEntry.mobileNumberCountryCodeAllowed")} placeholderTextColor={colors.textSecondary}/><Pressable accessibilityRole="button" disabled={busy||!phone||!country} style={styles.button} onPress={confirmSend}><Text style={styles.buttonText}>{t("providerEntry.sendCode")}</Text></Pressable><Text style={styles.label}>{t("providerEntry.yourNumberStaysPrivateSms")}</Text></>}
    {stage==='code'&&challenge&&<><Text style={styles.label}>{t("providerEntry.codeSentToMaskeddestination", { maskedDestination: challenge.maskedDestination })}</Text><TextInput autoFocus style={styles.input} accessibilityLabel={t("providerEntry.verificationCode")} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={challenge.codeLength} value={code} onChangeText={setCode}/><Pressable accessibilityRole="button" style={styles.button} disabled={busy||code.length!==challenge.codeLength} onPress={()=>void run(async()=>accept(await api.verifyPhone(challenge.challenge,code,!!onProof)))}><Text style={styles.buttonText}>{t("providerEntry.verifyCode")}</Text></Pressable><Pressable accessibilityRole="button" style={styles.button} disabled={busy||now<resendAt} onPress={()=>void send()}><Text style={styles.buttonText}>{now<resendAt?t("providerEntry.resendInValueS", { value: Math.ceil((resendAt-now)/1000) }):t("providerEntry.resendCode")}</Text></Pressable><Pressable accessibilityRole="button" style={styles.button} disabled={busy} onPress={()=>{setCode('');setStage('phone');}}><Text style={styles.buttonText}>{t("providerEntry.editNumber")}</Text></Pressable></>}
    {stage==='username'&&<><Text style={styles.label}>{t("providerEntry.chooseAUniqueUsernameAnd")}</Text><TextInput style={styles.input} accessibilityLabel={t("common.username")} autoCapitalize="none" autoCorrect={false} maxLength={30} value={username} onChangeText={text=>setUsername(text.toLowerCase())} placeholder={t("common.username")} placeholderTextColor={colors.textSecondary}/>{availabilityLine?<Text accessibilityLiveRegion="polite" style={availabilityLine.tone==='error'?styles.error:availabilityLine.tone==='success'?styles.available:styles.label}>{availabilityLine.text}</Text>:null}<TextInput style={styles.input} accessibilityLabel={t("providerEntry.displayNameOptional")} maxLength={60} value={name} onChangeText={setName} placeholder={t("providerEntry.displayNameOptional")} placeholderTextColor={colors.textSecondary}/>{hasTickLikeCharacter(name)?<Text accessibilityLiveRegion="polite" style={styles.error}>{nameTickError()}</Text>:null}<TextInput style={[styles.input,birthProblem?styles.inputError:null]} accessibilityLabel={birthProblem?t("providerEntry.dateOfBirthBirthproblem", { birthProblem }):t("providerEntry.dateOfBirth")} keyboardType="number-pad" autoComplete="off" textContentType="none" maxLength={10} value={birth} onChangeText={text=>setBirth(formatBirthDateInput(text))} placeholder={t("providerEntry.dateOfBirthDdMm")} placeholderTextColor={colors.textSecondary}/>{birthProblem?<Text accessibilityLiveRegion="polite" style={styles.error}>{birthProblem}</Text>:<Text style={styles.label}>{t("providerEntry.confirmsYourAgeNeverShown")}</Text>}<Pressable accessibilityRole="button" style={styles.button} disabled={busy||!username||usernameRefused(availability)||hasTickLikeCharacter(name)||!birthDate||!!birthDateProblem(birthDate)} onPress={()=>void finish()}><Text style={styles.buttonText}>{t("providerEntry.continueToKatkee")}</Text></Pressable><TermsNotice action='continue'/></>}
    {busy&&<ActivityIndicator color={colors.accentText}/>}{error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    <Pressable accessibilityRole="button" style={styles.button} disabled={busy} onPress={close}><Text style={styles.buttonText}>{t("common.back")}</Text></Pressable>
   </ScrollView></KeyboardAvoider>
  </Modal>
 </View>;
}
const styles=StyleSheet.create({fill:{flex:1,backgroundColor:colors.background},apple:{width:'100%',height:48,marginBottom:8},google:{width:'100%',height:48},button:{minHeight:48,padding:14,borderRadius:10,backgroundColor:colors.surfaceElevated,marginVertical:5,alignItems:'center'},buttonText:{color:colors.textPrimary,fontWeight:'600'},modal:{flexGrow:1,padding:24,paddingTop:60,backgroundColor:colors.background,gap:16,width:'100%',maxWidth:FORM_MAX_WIDTH,alignSelf:'center'},heading:{color:colors.textPrimary,fontSize:26,fontWeight:'700'},label:{color:colors.textSecondary},input:{minHeight:48,borderWidth:1,borderColor:colors.border,padding:14,color:colors.textPrimary,borderRadius:8},inputError:{borderColor:colors.danger},error:{color:colors.danger,paddingVertical:8},available:{color:colors.success},countries:{flexDirection:'row',flexWrap:'wrap',gap:8},country:{padding:14,borderWidth:1,borderColor:colors.border,borderRadius:8},selected:{borderColor:colors.accentText}});
