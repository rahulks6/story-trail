import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Modal,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {GoogleSignin,GoogleSigninButton,isSuccessResponse,isErrorWithCode,statusCodes} from '@react-native-google-signin/google-signin';
import * as Keychain from 'react-native-keychain';
import * as api from '../../api/providers';
import {providerBuild} from '../../config/providers';
import {useAuth} from '../../state/AuthContext';
import {colors} from '../../theme';
const PENDING_SERVICE='com.katkee.provider-onboarding.v1';
export function ProviderEntry({onProof}:{onProof?:(proof:string)=>Promise<void>}):React.JSX.Element {
 const {acceptSession}=useAuth();const [methods,setMethods]=useState<api.AuthMethods|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [stage,setStage]=useState<'closed'|'phone'|'code'|'username'>('closed');const [country,setCountry]=useState(''),[phone,setPhone]=useState(''),[code,setCode]=useState('');
 const [challenge,setChallenge]=useState<api.PhoneChallenge|null>(null),[resendAt,setResendAt]=useState(0),[now,setNow]=useState(Date.now());
 const [proof,setProof]=useState(''),[username,setUsername]=useState(''),[name,setName]=useState('');
 useEffect(()=>{let alive=true;void api.methods().then(m=>{if(alive){setMethods(m);setCountry(m.countries[0]??'');}}).catch(()=>{if(alive)setError('Additional sign-in methods are unavailable. Email sign-in is still available.');});
  if(!onProof)void Keychain.getGenericPassword({service:PENDING_SERVICE}).then(c=>{if(c&&alive){const p=JSON.parse(c.password);if(p.expiresAt>Date.now()){setProof(p.proof);setStage('username');}else void Keychain.resetGenericPassword({service:PENDING_SERVICE});}}).catch(()=>undefined);
  return()=>{alive=false;};},[onProof]);
 useEffect(()=>{if(stage!=='code')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[stage]);
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Unable to sign in. Try again.');}finally{setBusy(false);}}
 async function accept(result:api.ProviderResult){
  if('tokens' in result){await acceptSession(result);await Keychain.resetGenericPassword({service:PENDING_SERVICE});setStage('closed');return;}
  if(onProof){await onProof(result.proof);setStage('closed');return;}
  const saved=await Keychain.setGenericPassword('onboarding',JSON.stringify({proof:result.proof,expiresAt:Date.now()+result.expiresIn*1000}),{service:PENDING_SERVICE,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
  if(!saved)throw Error('Secure storage unavailable. Please try again.');setProof(result.proof);setStage('username');
 }
 const google=()=>run(async()=>{
  if(!providerBuild.googleWebClientId)throw Error('Google sign-in has not been configured for this build.');
  GoogleSignin.configure({webClientId:providerBuild.googleWebClientId,...(providerBuild.googleIosClientId?{iosClientId:providerBuild.googleIosClientId}:{}),offlineAccess:false});
  try{await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog:true});const response=await GoogleSignin.signIn();if(!isSuccessResponse(response))return;if(!response.data.idToken)throw Error('Google did not return a sign-in token.');await accept(await api.google(response.data.idToken,!!onProof));}
  catch(e){if(isErrorWithCode(e)&&e.code===statusCodes.SIGN_IN_CANCELLED)return;throw e;}
 });
 const send=()=>run(async()=>{const result=await api.requestPhone(phone,country);setChallenge(result);setCode('');setResendAt(Date.now()+result.resendAfter*1000);setNow(Date.now());setStage('code');});
 const confirmSend=()=>Alert.alert('Send verification code',`Send an SMS to ${country} •••• ${phone.replace(/\D/g,'').slice(-4)}?`,[{text:'Cancel',style:'cancel'},{text:'Send code',onPress:()=>void send()}]);
 const close=()=>{if(busy)return;setStage('closed');setError('');setCode('');};
 return <View>
  {methods?.google&&<GoogleSigninButton style={styles.google} size={GoogleSigninButton.Size.Wide} color={GoogleSigninButton.Color.Dark} disabled={busy} onPress={()=>void google()}/>}
  {methods?.phone&&<Pressable style={styles.button} disabled={busy} accessibilityRole="button" onPress={()=>{setError('');setStage('phone');}}><Text style={styles.buttonText}>Continue with Phone</Text></Pressable>}
  {stage==='closed'&&error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  <Modal visible={stage!=='closed'} animationType="slide" onRequestClose={close}>
   <ScrollView contentContainerStyle={styles.modal} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>{stage==='username'?'Choose your username':stage==='code'?'Enter verification code':'Continue with Phone'}</Text>
    {stage==='phone'&&<><Text style={styles.label}>Country / region</Text><View style={styles.countries}>{methods?.countries.map(c=><Pressable key={c} accessibilityRole="button" accessibilityState={{selected:country===c}} onPress={()=>setCountry(c)} style={[styles.country,country===c&&styles.selected]}><Text style={styles.label}>{c}</Text></Pressable>)}</View><TextInput style={styles.input} accessibilityLabel="Mobile number" keyboardType="phone-pad" textContentType="telephoneNumber" value={phone} onChangeText={setPhone} placeholder="Mobile number (country code allowed)" placeholderTextColor={colors.textSecondary}/><Pressable disabled={busy||!phone||!country} style={styles.button} onPress={confirmSend}><Text style={styles.buttonText}>Send Code</Text></Pressable><Text style={styles.label}>Your number stays private. SMS delivery may be delayed.</Text></>}
    {stage==='code'&&challenge&&<><Text style={styles.label}>Code sent to {challenge.maskedDestination}</Text><TextInput autoFocus style={styles.input} accessibilityLabel="Verification code" keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={challenge.codeLength} value={code} onChangeText={setCode}/><Pressable style={styles.button} disabled={busy||code.length!==challenge.codeLength} onPress={()=>void run(async()=>accept(await api.verifyPhone(challenge.challenge,code,!!onProof)))}><Text style={styles.buttonText}>Verify Code</Text></Pressable><Pressable style={styles.button} disabled={busy||now<resendAt} onPress={()=>void send()}><Text style={styles.buttonText}>{now<resendAt?`Resend in ${Math.ceil((resendAt-now)/1000)}s`:'Resend Code'}</Text></Pressable><Pressable style={styles.button} disabled={busy} onPress={()=>{setCode('');setStage('phone');}}><Text style={styles.buttonText}>Edit Number</Text></Pressable></>}
    {stage==='username'&&<><Text style={styles.label}>Only a unique username is required. You can finish your profile later.</Text><TextInput style={styles.input} accessibilityLabel="Username" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={colors.textSecondary}/><TextInput style={styles.input} accessibilityLabel="Display name (optional)" value={name} onChangeText={setName} placeholder="Display name (optional)" placeholderTextColor={colors.textSecondary}/><Pressable style={styles.button} disabled={busy||!username} onPress={()=>void run(async()=>accept(await api.complete(proof,username,name)))}><Text style={styles.buttonText}>Continue to Katkee</Text></Pressable></>}
    {busy&&<ActivityIndicator color={colors.accent}/>}{error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
    <Pressable style={styles.button} disabled={busy} onPress={close}><Text style={styles.buttonText}>Back</Text></Pressable>
   </ScrollView>
  </Modal>
 </View>;
}
const styles=StyleSheet.create({google:{width:'100%',height:48},button:{minHeight:48,padding:14,borderRadius:10,backgroundColor:colors.surfaceElevated,marginVertical:5,alignItems:'center'},buttonText:{color:colors.textPrimary,fontWeight:'600'},modal:{flexGrow:1,padding:24,paddingTop:60,backgroundColor:colors.background,gap:16},heading:{color:colors.textPrimary,fontSize:26,fontWeight:'700'},label:{color:colors.textSecondary},input:{minHeight:48,borderWidth:1,borderColor:colors.border,padding:14,color:colors.textPrimary,borderRadius:8},error:{color:colors.danger,paddingVertical:8},countries:{flexDirection:'row',flexWrap:'wrap',gap:8},country:{padding:14,borderWidth:1,borderColor:colors.border,borderRadius:8},selected:{borderColor:colors.accent}});
