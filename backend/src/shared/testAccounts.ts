/**
 * The walk-through and store-screenshot test accounts (support+e2e-…@katkee.com, auth/ci-verify.ts)
 * stay out of real people's suggestions, Home and Explore: only other test accounts see them, so a
 * screenshot run never shows its demo people and Stories to anyone real. `alias` is the users row
 * being listed; the query must bind :'viewer'.
 */
export const shownToViewerSql = (alias: string): string =>
  `(coalesce(${alias}.email, '') NOT ILIKE 'support+e2e-%@katkee.com'
    OR EXISTS (SELECT 1 FROM users tv WHERE tv.id = :'viewer' AND coalesce(tv.email, '') ILIKE 'support+e2e-%@katkee.com'))`;
