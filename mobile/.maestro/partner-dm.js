// Run by tour.yaml: the second test account (made by android-walkthrough.sh) opens a chat with the
// account under test and sends it a message, so the tour has a real conversation to use.
var API = "https://api.katkee.com";
var login = http.post(API + "/api/v1/auth/login", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: PARTNER_EMAIL, password: PARTNER_PASSWORD }),
});
if (login.status !== 200) throw new Error("Partner login: " + login.status);
var auth = { "Content-Type": "application/json", Authorization: "Bearer " + json(login.body).tokens.accessToken };
var chat = http.post(API + "/api/v1/users/" + USERNAME + "/conversation", { headers: auth, body: "{}" });
if (chat.status !== 200) throw new Error("Open chat: " + chat.status + " " + chat.body);
var id = json(chat.body).conversation.id;
var lines = ["Hey! Welcome to Katkee 👋", "Did you see my Story? The chai one ☕"];
for (var i = 0; i < lines.length; i++) {
  var sent = http.post(API + "/api/v1/conversations/" + id + "/messages", { headers: auth, body: JSON.stringify({ body: lines[i] }) });
  if (sent.status !== 201 && sent.status !== 200) throw new Error("Send: " + sent.status + " " + sent.body);
}
