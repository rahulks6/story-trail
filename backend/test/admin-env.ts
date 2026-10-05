import './env';
process.env.ADMIN_CONSOLE_ENABLED = 'true';
process.env.ADMIN_ORIGIN = 'http://admin.test';
process.env.ADS_ENABLED = 'true';
process.env.SPONSORED_STORIES_ENABLED = 'true';
process.env.AD_REPORTING_ENABLED = 'true';
// Test-only key for encrypting admin TOTP secrets at rest (never a production value).
process.env.ADMIN_MFA_ENCRYPTION_KEY ??= '6b61746b65652d746573742d6d66612d6b65792d33322d62797465732d2d2121';
