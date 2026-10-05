import './env';
process.env.GOOGLE_AUTH_ENABLED='true';process.env.GOOGLE_CLIENT_IDS='isolated-test-client';
process.env.PHONE_AUTH_ENABLED='true';process.env.PHONE_AUTH_COUNTRIES='US';
process.env.PHONE_IDENTITY_SECRET='isolated-test-phone-hash-secret-32-characters';
process.env.TWILIO_ACCOUNT_SID='AC'+'1'.repeat(32);process.env.TWILIO_AUTH_TOKEN='isolated-test-only';process.env.TWILIO_VERIFY_SERVICE_SID='VA'+'2'.repeat(32);
