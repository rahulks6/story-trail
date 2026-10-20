// Run by smoke.yaml on GitHub Actions: the throwaway account can't read its code email, so this
// asks GitHub for a signed OIDC token and has the API verify the account with it
// (backend/src/modules/auth/ci-verify.ts). OIDC_URL and OIDC_TOKEN come from the workflow.
var API = "https://api.katkee.com";
var oidc = http.get(OIDC_URL + "&audience=katkee-e2e", { headers: { Authorization: "bearer " + OIDC_TOKEN } });
if (oidc.status !== 200) throw new Error("GitHub OIDC token: " + oidc.status);
var login = http.post(API + "/api/v1/auth/login", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (login.status !== 200) throw new Error("Login: " + login.status);
var verified = http.post(API + "/api/v1/auth/email/ci-verify", {
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + json(login.body).tokens.accessToken },
  body: JSON.stringify({ token: json(oidc.body).value }),
});
if (verified.status !== 200) throw new Error("Verify: " + verified.status + " " + verified.body);
