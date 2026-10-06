import {Platform} from 'react-native';
import build from '../../build-config.json';
/** Public build configuration only. Never put secrets in this file or its JSON. */
export const appEnv = {
 apiBaseUrl: __DEV__
  ? (build.developmentApiUrl || (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000'))
  : build.productionApiUrl,
 /** The release version (build-config.json; Android and iOS builds use the same value). */
 appVersion: typeof build.appVersion === 'string' ? build.appVersion : '',
};
if(!__DEV__ && !/^https:\/\//.test(appEnv.apiBaseUrl))throw Error('Katkee release API is not configured. Run npm run check:release.');
