# Katkee public Story view-count policy

Final product rule:

- Anyone who is authorized to watch a Story may see its aggregate **view count**.
- A user who is not authorized to watch the Story cannot query its count.
- **Viewer identities are private to the Story owner.** Non-owners cannot fetch the viewer list.
- Detailed Story Insights remain owner-only.
- The Story detail response includes `viewCount` so the UI can render the aggregate without waiting for a second request. After the current viewer is recorded, the client refreshes the count.
- The backend remains the privacy boundary: `/api/v1/stories/:id/viewers` and `/api/v1/stories/:id/insights` are owner-only.

This intentionally supersedes the older master-PDF wording that said public users should not see Story view counts.
