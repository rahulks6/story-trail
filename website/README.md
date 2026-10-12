# katkee.com

The public website: the landing page, the Help Center, the Privacy Policy, the Terms of Service
and the account deletion page. The app, App Store Connect and Google Play link to these pages,
so they must be live before you submit (`npm run check:live`).

| Page | Address | Source |
| --- | --- | --- |
| Landing page | https://katkee.com/ | `src/pages/index.html` |
| Help Center (the stores' Support URL) | https://katkee.com/support | `src/pages/support.html` |
| Privacy Policy | https://katkee.com/privacy | `../legal/PRIVACY_POLICY.md` |
| Terms of Service | https://katkee.com/terms | `../legal/TERMS_OF_SERVICE.md` |
| Delete your account (Google Play's deletion URL) | https://katkee.com/delete-account | `src/pages/delete-account.html` |

## How it works

- **One source.** `build.cjs` puts every page in the same shell (`src/layout.html`) and style
  (`src/site.css`), renders the legal Markdown, and writes `public/`. It refuses broken links,
  contact addresses that aren't in `site.json`, inline scripts or styles, unfilled placeholders,
  and Markdown it can't render faithfully.
- **Served by the API.** The backend image carries `public/` (`backend/Dockerfile`) and serves
  it (`backend/src/modules/website`). With `WEBSITE_HOST=katkee.com`:
  - katkee.com serves only the website; the API and Admin console are never reachable there;
  - www.katkee.com redirects to katkee.com;
  - the website's pages asked for on api.katkee.com redirect to katkee.com.
- **Strict and private.** No scripts, no cookies, no analytics, nothing loaded from other sites.
  The Content-Security-Policy allows only the site's own images and stylesheet.
- **Fast.** Pages are compressed (brotli or gzip) and revalidated with ETags; images and the
  stylesheet have content-hashed names and are cached for a year.
- **Brand.** The icon, favicon, Apple touch icon and link-preview card are made from the app icon
  by `scripts/brand-assets.cjs`. Colours and type match the app (`BRAND.md`).

## Change something

```sh
# edit legal/*.md, website/src/** or website/site.json, then:
node website/build.cjs            # rewrite website/public
node website/build.cjs --check    # what scripts/verify.cjs runs: fails if public/ is stale
```

Commit `website/public/` with your change; the next image build and deploy publishes it.

**When the apps are live**, put their store links in `site.json` and rebuild. The "Coming soon"
buttons become "Download on the App Store" and "Get it on Google Play":

```json
"stores": {
  "appStore": "https://apps.apple.com/app/id<your app id>",
  "googlePlay": "https://play.google.com/store/apps/details?id=com.katkee.app"
}
```

## Hosting

The usual way is with the API (`infra/README.md`: `websiteDomainName=katkee.com`, the certificate
covering katkee.com and www.katkee.com, and DNS for both pointing at the load balancer). The
single-server route works the same way (`backend/docker-compose.prod.yml` and `Caddyfile`:
`WEBSITE_DOMAIN=katkee.com`).

`public/` is also a plain static site. To publish the pages before the API is deployed, upload
`public/` to any static host that serves `privacy.html` at `/privacy` (Netlify, Cloudflare Pages
and GitHub Pages do). Use the API-served site once the backend is live: it adds the security
headers and redirects that `npm run check:live` expects.

## Preview

Run the backend for development (`backend/README.md`), then open http://localhost:4000/,
/support, /privacy, /terms and /delete-account. Without `WEBSITE_HOST`, the pages are served on
every host.
