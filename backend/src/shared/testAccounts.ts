/**
 * The walk-through and store-screenshot test accounts (support+e2e-…@katkee.com, auth/ci-verify.ts)
 * and real people never see each other in suggestions, Home, Explore or Highlights to explore: a
 * screenshot run neither shows its demo people to anyone real nor puts anyone real into a store
 * screenshot. `alias` is the users row being listed; the query must bind :'viewer'.
 */
export const shownToViewerSql = (alias: string): string =>
  `((coalesce(${alias}.email, '') ILIKE 'support+e2e-%@katkee.com')
    = EXISTS (SELECT 1 FROM users tv WHERE tv.id = :'viewer' AND coalesce(tv.email, '') ILIKE 'support+e2e-%@katkee.com'))`;
