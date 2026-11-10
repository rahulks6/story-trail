/**
 * Display names for fixed lists whose values are also data (sent to the server, saved in drafts,
 * compared in code): topics, photo filters, drawing tools and text styles. The value stays
 * English; only what is shown goes through the catalogue. An unknown value shows as it is.
 */
import { t, type MessageKey } from "./index";

const TOPIC_KEYS: Record<string, MessageKey> = {
  Festivals: "topic.festivals", Food: "topic.food", Travel: "topic.travel", Music: "topic.music",
  Bollywood: "topic.bollywood", Cricket: "topic.cricket", Fashion: "topic.fashion", Dance: "topic.dance",
  Devotional: "topic.devotional", Fitness: "topic.fitness", Movies: "topic.movies", Photography: "topic.photography",
  Art: "topic.art", Comedy: "topic.comedy", Gaming: "topic.gaming", Tech: "topic.tech", Books: "topic.books",
  Nature: "topic.nature", Football: "topic.football", Cars: "topic.cars", Pets: "topic.pets", Startups: "topic.startups",
};

const FILTER_KEYS: Record<string, MessageKey> = {
  Original: "filter.original", Warm: "filter.warm", Cool: "filter.cool", Bright: "filter.bright", Cinema: "filter.cinema",
  Mono: "filter.mono", Vintage: "filter.vintage", Retro: "filter.retro", Film: "filter.film", Instant: "filter.instant", Sepia: "filter.sepia", Noir: "filter.noir", Soft: "filter.soft", Vivid: "filter.vivid", Night: "filter.night", Fade: "filter.fade",
};

const DRAW_TOOL_KEYS: Record<string, MessageKey> = {
  pen: "drawTool.pen", marker: "drawTool.marker", highlighter: "drawTool.highlighter", eraser: "drawTool.eraser",
};

const TEXT_STYLE_KEYS: Record<string, MessageKey> = {
  Clean: "textStyle.clean", Bold: "textStyle.strong", Classic: "textStyle.classic", Modern: "textStyle.modern",
  Typewriter: "textStyle.typewriter", Outline: "textStyle.outline", Soft: "textStyle.script", Highlight: "textStyle.neon",
};

function shown(keys: Record<string, MessageKey>, value: string): string {
  const key = keys[value];
  // Every key in these maps has no placeholders.
  return key ? (t as (k: MessageKey) => string)(key) : value;
}

/** "Cricket" -> "क्रिकेट": an interest or Story topic, as shown. */
export const topicLabel = (topic: string): string => shown(TOPIC_KEYS, topic);
/** A photo filter's name ("Warm"), as shown. */
export const filterLabel = (filter: string): string => shown(FILTER_KEYS, filter);
/** A drawing tool ("pen"), as shown. */
export const drawToolLabel = (tool: string): string => shown(DRAW_TOOL_KEYS, tool);
/** A text style ("Bold" is shown as "Strong"), as shown. */
export const textStyleLabel = (style: string): string => shown(TEXT_STYLE_KEYS, style);
