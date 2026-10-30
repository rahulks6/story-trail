import './env';
import {generateKeyPairSync} from 'node:crypto';
process.env.GOOGLE_AUTH_ENABLED='true';process.env.GOOGLE_CLIENT_IDS='isolated-test-client';
process.env.PHONE_AUTH_ENABLED='true';process.env.PHONE_AUTH_COUNTRIES='US';
process.env.PHONE_IDENTITY_SECRET='isolated-test-phone-hash-secret-32-characters';
process.env.TWILIO_ACCOUNT_SID='AC'+'1'.repeat(32);process.env.TWILIO_AUTH_TOKEN='isolated-test-only';process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'2'.repeat(32);
// Sign in with Apple, against a local stand-in for appleid.apple.com (appleAuth.test.ts points
// providerConfig.appleEndpoint at it); the client-secret key is generated per run.
process.env.APPLE_AUTH_ENABLED='true';process.env.APPLE_CLIENT_IDS='com.katkee.app';process.env.APPLE_TEAM_ID='TEAM123456';process.env.APPLE_KEY_ID='KEY1234567';
process.env.APPLE_PRIVATE_KEY=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
process.env.APPLE_AUTH_ENDPOINT='http://127.0.0.1:9';
