import {NativeModules, Platform} from 'react-native';
import build from '../../build-config.json';
/** Public build configuration only. Never put secrets in this file or its JSON. */
export const appEnv = {
 apiBaseUrl: __DEV__
  ? (build.developmentApiUrl || (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000'))
  : build.productionApiUrl,
 /**
  * The release version (build-config.json; Android and iOS builds use the same value) with the
  * build number when the app knows it, e.g. "1.0.0+82": every release is 1.0.0, so the build
  * number is what tells About, feedback and the analytics which release a phone runs.
  */
 appVersion: withBuild(typeof build.appVersion === 'string' ? build.appVersion : ''),
};

function withBuild(version: string): string {
 const code = (NativeModules.KatkeeAppInfo as {buildNumber?: unknown} | undefined)?.buildNumber;
 return typeof code === 'number' && code > 0 && version ? `${version}+${code}` : version;
}
if(!__DEV__ && !/^https:\/\//.test(appEnv.apiBaseUrl))throw Error('Katkee release API is not configured. Run npm run check:release.');
