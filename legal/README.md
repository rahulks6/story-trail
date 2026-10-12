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
- **Who operates Katkee.** The pages name "Katkee". If you trade through a company, use its legal
  name and add its postal address to section 1 of the policy and section 13 of the terms; some
  laws (GDPR article 13, for example) require the controller's identity and address.
- **India's IT Rules 2021, rule 3(2).** An intermediary must publish its Grievance Officer's name
  and contact details. The pages give grievance@katkee.com and the 24-hour acknowledgement and
  15-day resolution times; add the officer's name to policy section 11 and terms section 12.
- **Children.** Katkee is for people 13 and older. Accepting younger users is a different (much
  stricter) compliance path, COPPA in the US and similar rules elsewhere, that needs its own
  review.
- **GDPR, UK GDPR and CCPA/CPRA**, if you have users there: the rights are listed in policy
  section 8; check the legal bases and transfer mechanisms with your lawyer.
- **The store answers must match.** Apple's App Privacy answers and Google Play's Data safety
  form (`STORE_LISTING.md`, `docs/IOS_APP_STORE_DEPLOYMENT.md`,
  `docs/GOOGLE_PLAY_DEPLOYMENT.md`) must say the same as the policy.

## Mailboxes these pages promise

Create them, or forwarding addresses, before the pages go live:

| Address | Used for |
| --- | --- |
| support@katkee.com | Help with the app; the store listings' support contact |
| privacy@katkee.com | Data requests and account deletion without the app |
| grievance@katkee.com | Complaints under India's IT Rules (24-hour acknowledgement) |

## After editing

```sh
node website/build.cjs        # re-render website/public
node website/build.cjs --check  # what scripts/verify.cjs runs: fails if public/ is stale
```

Update **Last updated** at the top of the page you changed, and commit `website/public/` with it.
