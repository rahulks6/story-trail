import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { colors, radii, spacing } from "../theme";
import { useAuth } from "../state/AuthContext";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { getStickerPack, searchGifs, stickerImageUrl, type GiphySticker, type KatkeeSticker } from "../api/gifs";
import type { GifOverlayProperties } from "../models/storyDraft";
import { getLanguage, t, type MessageKey } from "../i18n";

const COLUMNS = 4;

type Cell = { key: string; kind: "katkee"; sticker: KatkeeSticker } | { key: string; kind: "giphy"; sticker: GiphySticker };
type Row = { key: string; kind: "header"; title: string; giphy: boolean } | { key: string; kind: "row"; cells: Cell[] } | { key: string; kind: "empty"; text: string };

const CATEGORY_KEYS: Record<string, Extract<MessageKey, `gifPicker.${"birthday" | "festivals" | "love" | "reactions" | "greetings" | "food" | "travel" | "cricket"}`>> = {
  birthday: "gifPicker.birthday",
  festivals: "gifPicker.festivals",
  love: "gifPicker.love",
  reactions: "gifPicker.reactions",
  greetings: "gifPicker.greetings",
  food: "gifPicker.food",
  travel: "gifPicker.travel",
  cricket: "gifPicker.cricket",
};
const categoryName = (c: string) => (CATEGORY_KEYS[c] ? t(CATEGORY_KEYS[c]!) : c);

function rows(prefix: string, cells: Cell[]): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < cells.length; i += COLUMNS) out.push({ key: `${prefix}-${i}`, kind: "row", cells: cells.slice(i, i + COLUMNS) });
  return out;
}

/**
 * The GIF tab: Katkee's own moving stickers first (by category, or matching the search), then
 * GIPHY's (trending, or the search), with "Powered by GIPHY" as GIPHY asks. Searches go through
 * Katkee's server; the stickers themselves load from where they live.
 */
export function GifPicker({ onPick }: { onPick: (properties: GifOverlayProperties) => void }): React.JSX.Element {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 350);
  const [pack, setPack] = useState<{ categories: string[]; stickers: KatkeeSticker[] } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [katkeeMatches, setKatkeeMatches] = useState<KatkeeSticker[]>([]);
  const [giphy, setGiphy] = useState<GiphySticker[]>([]);
  const [giphyOn, setGiphyOn] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const search = useRef(0);

  useEffect(() => {
    if (!accessToken) return;
    getStickerPack(accessToken)
      .then((p) => {
        setPack(p);
        setGiphyOn(p.giphy);
        setCategory((c) => c ?? p.categories[0] ?? null);
      })
      .catch(() => setFailed(true));
  }, [accessToken]);

  // Trending (no search) or the search's first page.
  useEffect(() => {
    if (!accessToken) return;
    const id = ++search.current;
    setLoading(true);
    setFailed(false);
    searchGifs(accessToken, debounced, 0, getLanguage())
      .then((r) => {
        if (id !== search.current) return;
        setKatkeeMatches(r.katkee);
        setGiphy(r.giphy);
        setGiphyOn(r.giphyEnabled);
        setNextOffset(r.nextOffset);
      })
      .catch(() => {
        if (id === search.current) setFailed(true);
      })
      .finally(() => {
        if (id === search.current) setLoading(false);
      });
  }, [accessToken, debounced]);

  const loadMore = () => {
    if (!accessToken || loading || nextOffset === null) return;
    const id = search.current;
    setLoading(true);
    searchGifs(accessToken, debounced, nextOffset, getLanguage())
      .then((r) => {
        if (id !== search.current) return;
        setGiphy((g) => [...g, ...r.giphy.filter((s) => !g.some((x) => x.id === s.id))]);
        setNextOffset(r.nextOffset);
      })
      .catch(() => undefined)
      .finally(() => {
        if (id === search.current) setLoading(false);
      });
  };

  const searching = debounced.trim().length > 0;
  const data = useMemo<Row[]>(() => {
    const own = searching ? katkeeMatches : (pack?.stickers ?? []).filter((s) => s.category === category);
    const out: Row[] = [];
    if (own.length) {
      out.push({ key: "h-katkee", kind: "header", title: t("gifPicker.katkeeStickers"), giphy: false });
      out.push(...rows("k", own.map((s) => ({ key: `k-${s.id}`, kind: "katkee" as const, sticker: s }))));
    }
    if (giphyOn && giphy.length) {
      out.push({ key: "h-giphy", kind: "header", title: searching ? t("gifPicker.moreFromGiphy") : t("gifPicker.trending"), giphy: true });
      out.push(...rows("g", giphy.map((s) => ({ key: `g-${s.id}`, kind: "giphy" as const, sticker: s }))));
    }
    if (!out.length && !loading) out.push({ key: "empty", kind: "empty", text: failed ? t("gifPicker.couldntLoad") : t("gifPicker.nothingFound") });
    return out;
  }, [searching, katkeeMatches, pack, category, giphyOn, giphy, loading, failed]);

  const pick = (cell: Cell) => {
    if (cell.kind === "katkee") onPick({ source: "katkee", id: cell.sticker.id, url: cell.sticker.url, width: cell.sticker.size, height: cell.sticker.size });
    else onPick({ source: "giphy", id: cell.sticker.id, url: cell.sticker.url, width: cell.sticker.width, height: cell.sticker.height });
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("gifPicker.search")}
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={t("gifPicker.search")}
        testID="gif-search"
      />
      {!searching && pack && pack.categories.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow} keyboardShouldPersistTaps="handled">
          {pack.categories.map((c) => (
            <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]} accessibilityRole="tab" accessibilityState={{ selected: category === c }} testID={`gif-category-${c}`}>
              <Text style={[styles.chipLabel, category === c && styles.chipLabelActive]}>{categoryName(c)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <FlatList
        data={data}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        initialNumToRender={6}
        windowSize={5}
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return (
              <View style={styles.header}>
                <Text style={styles.headerText}>{item.title}</Text>
                {item.giphy ? <Text style={styles.giphy}>Powered by GIPHY</Text> : null}
              </View>
            );
          }
          if (item.kind === "empty") return <Text style={styles.empty}>{item.text}</Text>;
          return (
            <View style={styles.row}>
              {item.cells.map((cell) => (
                <Pressable
                  key={cell.key}
                  style={styles.cell}
                  onPress={() => pick(cell)}
                  accessibilityRole="button"
                  accessibilityLabel={t("gifPicker.addSticker", { name: cell.kind === "katkee" ? cell.sticker.tags[0] ?? cell.sticker.id : cell.sticker.title || "GIPHY" })}
                  testID={`gif-${cell.key}`}
                >
                  <Image
                    source={{ uri: stickerImageUrl(cell.kind === "katkee" ? cell.sticker.url : cell.sticker.previewUrl) }}
                    style={styles.image}
                    resizeMode="contain"
                  />
                </Pressable>
              ))}
              {Array.from({ length: COLUMNS - item.cells.length }, (_, i) => <View key={`pad-${i}`} style={styles.cell} />)}
            </View>
          );
        }}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.textSecondary} style={styles.spinner} /> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 420 },
  input: { color: colors.textPrimary, backgroundColor: colors.surfaceElevated, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.sm },
  chips: { flexGrow: 0, marginBottom: spacing.sm },
  chipsRow: { gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: { color: colors.textSecondary, fontSize: 12 },
  chipLabelActive: { color: colors.onAccent, fontWeight: "700" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs, marginBottom: spacing.xs },
  headerText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  giphy: { color: colors.textSecondary, fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  row: { flexDirection: "row" },
  cell: { flex: 1, aspectRatio: 1, padding: 4 },
  image: { width: "100%", height: "100%" },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: spacing.lg },
  spinner: { marginVertical: spacing.sm },
});
