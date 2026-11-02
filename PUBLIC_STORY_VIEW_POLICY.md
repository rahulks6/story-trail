# Katkee public Story view-count policy

Final product rule:

- Anyone who is authorized to watch a Story may see its aggregate **view count**.
- A user who is not authorized to watch the Story cannot query its count.
- **Viewer identities are private to the Story owner.** Non-owners cannot fetch the viewer list.
- Detailed Story Insights remain owner-only.
- The Story detail response includes `viewCount` so the UI can render the aggregate without waiting for a second request. After the current viewer is recorded, the client refreshes the count.
- The backend remains the privacy boundary: `/api/v1/stories/:id/viewers` and `/api/v1/stories/:id/insights` are owner-only.

This intentionally supersedes the older master-PDF wording that said public users should not see Story view counts.

## Stories watched on the web

Public Stories can also be watched signed out, on katkee.com (`/u/<username>`, `/s/<story id>`; see `backend/src/modules/website/web-profile.ts`). Those plays are **never** counted:

- no row in `story_views`, so a web play is not in the view count, the viewer list or Story Insights;
- no `profile_visit` or other recommendation event, and no reach, so the web can't inflate ranking or a creator's dashboard;
- no likes, comments, view counts, sticker results or quiz answers are shown on the web.

The only record is an aggregate count of web pages opened per day by kind (`web_page_views`: profile or Story), with nothing about the visitor or which profile.
