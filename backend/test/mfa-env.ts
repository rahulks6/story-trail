// The key two-step login seals authenticator secrets with (production sets ADMIN_MFA_ENCRYPTION_KEY).
process.env.ADMIN_MFA_ENCRYPTION_KEY ??= "6b61746b65652d746573742d6d66612d6b65792d33322d62797465732d2d2121";
