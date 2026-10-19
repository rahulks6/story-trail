# Legal pages

`PRIVACY_POLICY.md` and `TERMS_OF_SERVICE.md` are the source of the pages published at
https://katkee.com/privacy and https://katkee.com/terms. `website/build.cjs` renders them into
`website/public/`, which the API serves on katkee.com (see `website/README.md`).

**They are not legal advice.** They describe what the code actually does (checked against
`backend/`: the schema, retention jobs, moderation and account code), but no lawyer has
reviewed them. Have them reviewed before launch, in particular:

- **Terms section 9 (liability) and section 11 (governing law).** Governing law is set to India,
  where the service is hosted (AWS Mumbai) and where phone sign-in is offered first. Change it if
  your company is elsewhere.
- **Who operates Katkee.** Rahul Katakdhond, a sole proprietorship registered in India (policy
  section 1, terms introduction and section 13; the website's footer reads `website/site.json`).
  If the registration uses a trade name, add it ("Rahul Katakdhond, trading as ..."), and
  consider adding the registered business address. If you later form a company (needed before
  you can take investment), replace the operator everywhere with the company's legal name.
- **India's IT Rules 2021, rule 3(2): Grievance Officer.** Published as Rahul Katakdhond,
  grievance@katkee.com, with the 24-hour acknowledgement and 15-day resolution, the 72-hour
  removal and 24-hour intimate-image timelines, and the appeal to the Grievance Appellate
  Committee (gac.gov.in) within 30 days (terms section 12, policy section 11, the Help Center).
- **IT Rules rule 3(1)(h): 180 days.** Registration details of a deleted account are kept 180
  days after deletion (`deleted_account_records`, policy section 7). The CERT-In directions of
  2022 need logs kept 180 days in India; the AWS stack does that (`infra/`).
- **Adults only (18+).** India's DPDP Act 2023 treats everyone under 18 as a child and needs
  verifiable parental consent to process a child's data. Katkee avoids that by refusing anyone
  under 18 at sign-up (date of birth, checked on the server: `backend/src/modules/auth/age.ts`)
  and deleting accounts found to belong to children (terms section 2, policy section 9).
  Accepting younger users would be a different, much stricter compliance path.
- **DPDP Act 2023 and Rules 2025.** Most duties apply from 2027. The policy already gives the
  rights (section 8), names the Data Fiduciary and contact, and offers the policy in Eighth
  Schedule languages on request. Keep watching for the Data Protection Board's procedures.
- **GDPR, UK GDPR and CCPA/CPRA**, if you have users there: the rights are listed in policy
  section 8; check the legal bases and transfer mechanisms with your lawyer.
- **Worldwide release (from 19 October 2026).** Katkee is offered in every country, run from India
  with the data in AWS Mumbai. The policy now covers GDPR (legal bases, transfers, the right to
  complain), US state laws (no sale or sharing) and other countries (section 8). Before launch,
  check with a lawyer:
  - **EU and UK representatives (GDPR Article 27, UK GDPR Article 27).** A controller outside the
    EU or UK that offers its service there usually needs a representative there. Representative
    services exist for a yearly fee; add their address to policy section 11.
  - **EU Digital Services Act.** Katkee is an online platform for EU users: it needs a published
    point of contact and an EU legal representative, the reasons for each moderation decision
    (Katkee's moderation records them, and appeals exist), and a yearly count of EU users.
  - **UK Online Safety Act.** Services with UK users must assess and act on illegal-content risks
    and publish how. Katkee's reporting, blocking and moderation are the base for it.
  - **Store "trader" status for the EU.** App Store Connect and Play Console ask whether you're a
    trader under the DSA; a trader must publish an address, phone number and email on the EU
    store pages.
  - **Twilio phone sign-in** (if you turn it on): each country you add to `PHONE_AUTH_COUNTRIES`
    must also be allowed in Twilio's Geo permissions; some countries need sender registration.
- **The store answers must match.** Apple's App Privacy answers and Google Play's Data safety
  form (`STORE_LISTING.md`, `docs/IOS_APP_STORE_DEPLOYMENT.md`,
  `docs/GOOGLE_PLAY_DEPLOYMENT.md`) must say the same as the policy.

## Mailboxes these pages promise

Create them, or forwarding addresses, before the pages go live:

| Address | Used for |
| --- | --- |
| support@katkee.com | Help with the app; the store listings' support contact |
| privacy@katkee.com | Data requests and account deletion without the app |
| grievance@katkee.com | Complaints to the Grievance Officer, Rahul Katakdhond, under India's IT Rules (24-hour acknowledgement) |

## After editing

```sh
node website/build.cjs        # re-render website/public
node website/build.cjs --check  # what scripts/verify.cjs runs: fails if public/ is stale
```

Update **Last updated** at the top of the page you changed, and commit `website/public/` with it.
