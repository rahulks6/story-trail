import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { query, queryOne } from "../../db/psql";
import { asLocale, type Locale } from "../../shared/locale";
import { FESTIVAL_TIME_ZONE } from "../festivals/festivals";

/**
 * Today's theme: one easy idea for a Story, the same for everyone each day ("Today's sky",
 * "What's on your plate"), so nobody has to wonder what to post. Home shows it to anyone who
 * hasn't posted today, and the evening reminder (runReturnReasons) mentions it to some of them,
 * a few times a week at most.
 */
export interface DailyTheme {
  slug: string;
  emoji: string;
  title: Record<Locale, string>;
}

export const DAILY_THEMES: readonly DailyTheme[] = [
  { slug: "chai", emoji: "☕", title: { en: "Your chai or coffee moment", hi: "आपका चाय या कॉफ़ी वाला पल", mr: "तुमचा चहा किंवा कॉफीचा क्षण", es: "Tu momento de té o café", pt: "Seu momento do chá ou café", id: "Momen teh atau kopimu", fr: "Ton moment thé ou café", de: "Dein Tee- oder Kaffeemoment", ar: "لحظة الشاي أو القهوة" } },
  { slug: "view", emoji: "🌅", title: { en: "The view from where you are", hi: "जहां आप हैं, वहां का नज़ारा", mr: "तुम्ही जिथे आहात तिथलं दृश्य", es: "La vista desde donde estás", pt: "A vista de onde você está", id: "Pemandangan dari tempatmu", fr: "La vue depuis là où tu es", de: "Der Blick von dort, wo du bist", ar: "المنظر من مكانك" } },
  { slug: "food", emoji: "🍛", title: { en: "What's on your plate today", hi: "आज आपकी थाली में क्या है", mr: "आज तुमच्या ताटात काय आहे", es: "Qué hay en tu plato hoy", pt: "O que tem no seu prato hoje", id: "Apa yang ada di piringmu hari ini", fr: "Ce qu'il y a dans ton assiette", de: "Was heute auf deinem Teller ist", ar: "ماذا في طبقك اليوم" } },
  { slug: "outfit", emoji: "👟", title: { en: "Today's outfit", hi: "आज का आउटफ़िट", mr: "आजचा आउटफिट", es: "Tu outfit de hoy", pt: "Seu look de hoje", id: "Outfit hari ini", fr: "Ta tenue du jour", de: "Dein Outfit heute", ar: "إطلالة اليوم" } },
  { slug: "pet", emoji: "🐾", title: { en: "A pet, yours or a friend's", hi: "कोई पालतू, आपका या दोस्त का", mr: "एखादा पाळीव प्राणी, तुमचा किंवा मित्राचा", es: "Una mascota, tuya o de un amigo", pt: "Um pet, seu ou de um amigo", id: "Hewan peliharaan, milikmu atau teman", fr: "Un animal, le tien ou celui d'un ami", de: "Ein Haustier, deins oder von Freunden", ar: "حيوان أليف، لك أو لصديق" } },
  { slug: "desk", emoji: "💻", title: { en: "Your desk or study corner", hi: "आपकी डेस्क या पढ़ाई का कोना", mr: "तुमचा डेस्क किंवा अभ्यासाचा कोपरा", es: "Tu escritorio o rincón de estudio", pt: "Sua mesa ou cantinho de estudo", id: "Meja atau pojok belajarmu", fr: "Ton bureau ou coin d'étude", de: "Dein Schreibtisch oder Lernplatz", ar: "مكتبك أو ركن دراستك" } },
  { slug: "song", emoji: "🎧", title: { en: "The song stuck in your head", hi: "वो गाना जो दिमाग़ में अटका है", mr: "डोक्यात अडकलेलं गाणं", es: "La canción que no sale de tu cabeza", pt: "A música que não sai da sua cabeça", id: "Lagu yang terus terngiang", fr: "La chanson qui te trotte dans la tête", de: "Der Song, der dir nicht aus dem Kopf geht", ar: "الأغنية العالقة في رأسك" } },
  { slug: "sky", emoji: "☁️", title: { en: "Today's sky", hi: "आज का आसमान", mr: "आजचं आकाश", es: "El cielo de hoy", pt: "O céu de hoje", id: "Langit hari ini", fr: "Le ciel d'aujourd'hui", de: "Der Himmel heute", ar: "سماء اليوم" } },
  { slug: "gang", emoji: "🤝", title: { en: "Your gang", hi: "आपकी गैंग", mr: "तुमची गँग", es: "Tu grupo de amigos", pt: "Sua turma", id: "Gengmu", fr: "Ta bande", de: "Deine Clique", ar: "شلّتك" } },
  { slug: "street", emoji: "🛺", title: { en: "Your street right now", hi: "अभी आपकी गली", mr: "आत्ता तुमचा रस्ता", es: "Tu calle ahora mismo", pt: "Sua rua agora", id: "Jalananmu sekarang", fr: "Ta rue en ce moment", de: "Deine Straße gerade jetzt", ar: "شارعك الآن" } },
  { slug: "throwback", emoji: "📸", title: { en: "A throwback photo", hi: "कोई पुरानी याद वाली फ़ोटो", mr: "एखादा जुन्या आठवणीचा फोटो", es: "Una foto del recuerdo", pt: "Uma foto antiga", id: "Foto kenangan", fr: "Une photo souvenir", de: "Ein Foto von früher", ar: "صورة من الذكريات" } },
  { slug: "snack", emoji: "🍟", title: { en: "Your favourite snack", hi: "आपका पसंदीदा स्नैक", mr: "तुमचा आवडता खाऊ", es: "Tu snack favorito", pt: "Seu lanche favorito", id: "Camilan favoritmu", fr: "Ton snack préféré", de: "Dein Lieblingssnack", ar: "وجبتك الخفيفة المفضلة" } },
  { slug: "smile", emoji: "😊", title: { en: "Something that made you smile", hi: "कुछ ऐसा जिसने आपको मुस्कुराया", mr: "तुम्हाला हसवणारं काहीतरी", es: "Algo que te hizo sonreír", pt: "Algo que te fez sorrir", id: "Sesuatu yang membuatmu tersenyum", fr: "Quelque chose qui t'a fait sourire", de: "Etwas, das dich zum Lächeln brachte", ar: "شيء جعلك تبتسم" } },
  { slug: "home", emoji: "🏡", title: { en: "Your favourite corner at home", hi: "घर का आपका पसंदीदा कोना", mr: "घरातला तुमचा आवडता कोपरा", es: "Tu rincón favorito de casa", pt: "Seu cantinho favorito em casa", id: "Sudut favoritmu di rumah", fr: "Ton coin préféré à la maison", de: "Deine Lieblingsecke zu Hause", ar: "ركنك المفضل في البيت" } },
];

const DAY_MS = 86_400_000;

/** Today's date in India (YYYY-MM-DD): everyone's theme changes at the same midnight. */
export function indiaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FESTIVAL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The theme for a date: the list in order, one a day, starting again after the last. */
export function themeForDate(date: string): DailyTheme {
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  return DAILY_THEMES[((days % DAILY_THEMES.length) + DAILY_THEMES.length) % DAILY_THEMES.length]!;
}

export function themeBySlug(slug: unknown): DailyTheme | null {
  return DAILY_THEMES.find((t) => t.slug === slug) ?? null;
}

/** At most this many theme reminders a week, so they stay welcome. */
export const THEME_PUSHES_PER_WEEK = 3;

/**
 * The evening theme reminder, for people who haven't posted today: never on top of a streak,
 * nudge or festival push the same day, never more than THEME_PUSHES_PER_WEEK a week, and not on a
 * festival's first day (its greeting is the reason to post). Off with the other reminders.
 */
export async function queueDailyThemePushes(now = new Date()): Promise<number> {
  const date = indiaDate(now);
  const theme = themeForDate(date);
  const day = `(now() AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date`;
  const rows = await query(
    `WITH targets AS (
       SELECT u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id
       WHERE u.is_active AND u.deleted_at IS NULL
         AND coalesce(p.push_enabled, true) AND coalesce(p.reminders_enabled, true)
         AND EXISTS (SELECT 1 FROM push_devices d WHERE d.user_id = u.id AND d.disabled_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM festivals f WHERE f.starts_on = ${day})
         AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.owner_id = u.id AND (s.created_at AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date = ${day})
         AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind IN ('streak', 'nudge', 'festival') AND ps.sent_at > now() - interval '20 hours')
         AND (SELECT count(*) FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind = 'daily_theme' AND ps.sent_at > now() - interval '7 days') < :'per_week'
       LIMIT 2000),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key) SELECT id, 'daily_theme', :'date' FROM targets
       ON CONFLICT DO NOTHING RETURNING user_id)
     INSERT INTO push_outbox (user_id, kind, body, link, params)
     SELECT user_id, 'daily_theme', :'body', 'katkee://home', jsonb_build_object('slug', :'slug'::text)
     FROM sent
     RETURNING id`,
    { date, slug: theme.slug, per_week: THEME_PUSHES_PER_WEEK, body: `${theme.emoji} Today's theme: ${theme.title.en}. Share yours on Katkee` },
  );
  return rows.length;
}

export function registerDailyThemeRoutes(router: Router): void {
  // Today's theme in the person's language, and whether they've posted today (Home hides it then).
  router.get("/api/v1/themes/today", async (req, res) => {
    requireAuth(req);
    const userId = req.userId as string;
    const user = await queryOne(
      `SELECT locale, EXISTS (SELECT 1 FROM stories s WHERE s.owner_id = u.id AND s.deleted_at IS NULL
                AND (s.created_at AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date = (now() AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date) AS posted
       FROM users u WHERE u.id = :'user'`,
      { user: userId },
    );
    const date = indiaDate();
    const theme = themeForDate(date);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { date, slug: theme.slug, emoji: theme.emoji, title: theme.title[asLocale(user?.locale)], postedToday: user?.posted === "t" });
  });
}
