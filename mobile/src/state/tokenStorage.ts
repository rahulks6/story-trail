/** A single Keychain/Keystore record keeps each token pair atomic at rest. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
const SERVICE = 'com.katkee.session.v1';
const LEGACY_KEYS = ['katkee.accessToken', 'katkee.refreshToken'];
export interface StoredTokens { accessToken:string; refreshToken:string }
let pending:Promise<unknown> = Promise.resolve();
function serialized<T>(operation:()=>Promise<T>):Promise<T> {
 const result=pending.then(operation,operation);
 pending=result.catch(()=>undefined);
 return result;
}
function parse(value:unknown):StoredTokens {
 if(!value||typeof value!=='object'||typeof (value as StoredTokens).accessToken!=='string'||typeof (value as StoredTokens).refreshToken!=='string'||!(value as StoredTokens).accessToken||!(value as StoredTokens).refreshToken)throw new Error('Stored session is invalid.');
 return value as StoredTokens;
}
async function write(tokens:StoredTokens):Promise<void> {
 const saved=await Keychain.setGenericPassword('session',JSON.stringify(parse(tokens)),{service:SERVICE,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
 if(!saved)throw new Error('Secure session storage is unavailable.');
}
export function loadTokens():Promise<StoredTokens|null> {return serialized(async()=>{
 const credentials=await Keychain.getGenericPassword({service:SERVICE});
 if(credentials){const tokens=parse(JSON.parse(credentials.password));await AsyncStorage.removeMany(LEGACY_KEYS);return tokens;}
 const old=await AsyncStorage.getMany(LEGACY_KEYS);
 const accessToken=old[LEGACY_KEYS[0]!],refreshToken=old[LEGACY_KEYS[1]!];
 if(!accessToken||!refreshToken){await AsyncStorage.removeMany(LEGACY_KEYS);return null;}
 const tokens={accessToken,refreshToken};
 // Never delete a working legacy session until encrypted storage confirms its write.
 await write(tokens);await AsyncStorage.removeMany(LEGACY_KEYS);return tokens;
});}
export function saveTokens(tokens:StoredTokens):Promise<void> {return serialized(async()=>{await write(tokens);await AsyncStorage.removeMany(LEGACY_KEYS);});}
export function clearTokens():Promise<void> {return serialized(async()=>{await Keychain.resetGenericPassword({service:SERVICE});await AsyncStorage.removeMany(LEGACY_KEYS);});}
