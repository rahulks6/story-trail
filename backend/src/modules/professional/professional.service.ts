/**
 * Professional accounts (migration 0066): a free switch in Settings for creators, artists,
 * businesses and public figures. It unlocks the professional dashboard (dashboard.ts) and shows
 * the chosen category quietly under the name on the profile (unless hidden). It changes nothing
 * about who sees the account's Stories and gives no ranking boost anywhere. Switching back is
 * just as free, and the dashboard's own cached numbers go with it.
 *
 * A private account can't be professional. The dashboard is about reaching people beyond the
 * ones you approve, and a creator's category on a locked profile would advertise something
 * nobody can see. The database holds the rule too (users_professional_is_public), so a private
 * switch made at the same moment can't slip past it.
 */
import { DatabaseError, query, queryOne, type Row } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { ValidationError } from "../auth/dto";
import type { Category as BadgeCategory } from "../verification/verification.service";
import { knownTimeZone } from "./timeZones";

/**
 * The verified badge's categories, plus "artist" (musicians, painters, performers), which the
 * badge folds into "creator" but a dashboard's owner wants to name. "brand" reads as "Business"
 * in the app.
 */
export const PROFESSIONAL_CATEGORIES = ["creator", "artist", "public_figure", "brand", "news_media", "organization"] as const;
export type ProfessionalCategory = (typeof PROFESSIONAL_CATEGORIES)[number];
// Every badge category stays a professional one, so a verified account always has its match
// (the compiler checks).
const badgeCategoriesIncluded: BadgeCategory extends ProfessionalCategory ? true : never = true;
void badgeCategoriesIncluded;

export const PRIVATE_ACCOUNT_MESSAGE = "Private accounts can't be professional. Make your account public first.";

export interface ProfessionalStatus {
  /** null for a personal account. */
  professional: { category: ProfessionalCategory; showCategory: boolean; since: string } | null;
  /** Whether the switch can be made now, and why not, in sentences the app shows as they are. */
  eligibility: { eligible: boolean; reasons: string[] };
}

export interface ProfessionalInput {
  category: ProfessionalCategory;
  showCategory: boolean;
  /** The phone's IANA time zone, for the dashboard's days and hours. */
  timeZone: string | null;
}

export function parseProfessionalInput(body: unknown): ProfessionalInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const category = b.category;
  if (typeof category !== "string" || !(PROFESSIONAL_CATEGORIES as readonly string[]).includes(category)) {
    errors.category = `category must be one of: ${PROFESSIONAL_CATEGORIES.join(", ")}.`;
  }
  if (b.showCategory !== undefined && typeof b.showCategory !== "boolean") errors.showCategory = "showCategory must be a boolean.";
  if (b.timeZone !== undefined && b.timeZone !== null && (typeof b.timeZone !== "string" || b.timeZone.length > 64)) {
    errors.timeZone = "timeZone must be a time zone name.";
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return {
    category: category as ProfessionalCategory,
    showCategory: b.showCategory !== false,
    timeZone: typeof b.timeZone === "string" ? b.timeZone : null,
  };
}

// As ISO 8601 (to_json), which is what the contract with the app promises.
const STATUS_COLUMNS = `is_private, professional_category, professional_category_shown,
  to_json(professional_since) #>> '{}' AS professional_since`;

function toStatus(row: Row): ProfessionalStatus {
  const isPrivate = row.is_private === "t";
  const category = row.professional_category as ProfessionalCategory | null;
  return {
    professional: category
      ? { category, showCategory: row.professional_category_shown !== "f", since: row.professional_since as string }
      : null,
    eligibility: isPrivate && !category ? { eligible: false, reasons: [PRIVATE_ACCOUNT_MESSAGE] } : { eligible: true, reasons: [] },
  };
}

export async function getStatus(userId: string): Promise<ProfessionalStatus> {
  const row = await queryOne(`SELECT ${STATUS_COLUMNS} FROM users WHERE id = :'id' AND deleted_at IS NULL`, { id: userId });
  if (!row) throw new HttpError(404, "User not found.");
  return toStatus(row);
}

/** The category and time zone of a professional account; null for a personal one. */
export async function professionalSettings(userId: string): Promise<{ category: ProfessionalCategory; timeZone: string | null } | null> {
  const row = await queryOne(
    `SELECT professional_category, professional_time_zone FROM users WHERE id = :'id' AND deleted_at IS NULL AND professional_category IS NOT NULL`,
    { id: userId },
  );
  return row ? { category: row.professional_category as ProfessionalCategory, timeZone: row.professional_time_zone ?? null } : null;
}

/**
 * Switches to a professional account, or changes its category or whether it shows. `since` keeps
 * the first switch's date. An unknown time zone is left out rather than refusing the switch.
 */
export async function setProfessional(userId: string, input: ProfessionalInput): Promise<ProfessionalStatus> {
  const timeZone = input.timeZone && (await knownTimeZone(input.timeZone)) ? input.timeZone : null;
  let row: Row | null;
  try {
    row = await queryOne(
      `UPDATE users SET professional_category = :'category', professional_category_shown = :'shown'::boolean,
              professional_since = coalesce(professional_since, now()),
              professional_time_zone = coalesce(NULLIF(:'tz', ''), professional_time_zone)
       WHERE id = :'id' AND deleted_at IS NULL AND NOT is_private
       RETURNING ${STATUS_COLUMNS}`,
      { id: userId, category: input.category, shown: input.showCategory, tz: timeZone ?? "" },
    );
  } catch (error) {
    if (error instanceof DatabaseError && error.detail.includes("users_professional_is_public")) row = null;
    else throw error;
  }
  if (row) return toStatus(row);
  const current = await getStatus(userId);
  if (!current.eligibility.eligible) throw new HttpError(409, PRIVATE_ACCOUNT_MESSAGE, undefined, undefined, "private_account");
  throw new HttpError(409, "Couldn't switch your account. Try again.");
}

/** Back to a personal account: the category leaves the profile and the dashboard's cache goes. */
export async function switchToPersonal(userId: string): Promise<ProfessionalStatus> {
  const row = await queryOne(
    `WITH cache AS (DELETE FROM professional_audience_hours WHERE user_id = :'id')
     UPDATE users SET professional_category = NULL, professional_category_shown = true, professional_since = NULL, professional_time_zone = NULL
     WHERE id = :'id' AND deleted_at IS NULL
     RETURNING ${STATUS_COLUMNS}`,
    { id: userId },
  );
  if (!row) throw new HttpError(404, "User not found.");
  return toStatus(row);
}

/** Remembers the phone's time zone when the dashboard is opened from somewhere new. */
export async function rememberTimeZone(userId: string, timeZone: string): Promise<void> {
  await query(
    `UPDATE users SET professional_time_zone = :'tz'
     WHERE id = :'id' AND professional_category IS NOT NULL AND professional_time_zone IS DISTINCT FROM :'tz'`,
    { id: userId, tz: timeZone },
  );
}
