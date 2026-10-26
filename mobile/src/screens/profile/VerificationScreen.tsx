import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { launchCamera, launchImageLibrary, type ImagePickerResponse } from "react-native-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import { uploadPhoto } from "../../api/media";
import {
  getVerification,
  MAX_FULL_NAME_LENGTH,
  MAX_LINK_LENGTH,
  MAX_VERIFICATION_LINKS,
  requestVerification,
  VERIFICATION_CATEGORIES,
  verificationCategoryLabel,
  withdrawVerification,
  type VerificationCategory,
  type VerificationStatus,
} from "../../api/verification";
import { serverDate, serverTimeMs } from "../../utils/serverTime";
import { Banner, Button, TextField } from "../../components/Form";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { ActionSheet } from "../../components/ActionSheet";
import { LoadFailed } from "../../components/LoadFailed";
import { Icon } from "../../components/Icon";
import { tapFeedback } from "../../utils/haptics";

type Props = NativeStackScreenProps<RootStackParamList, "Verification">;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Nov 2026", the way the server writes dates in its reasons. */
export function verificationDate(iso: string | null | undefined): string {
  const date = serverDate(iso);
  return date ? `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}` : "";
}

/** A link the form accepts: https, a real host, at most 300 characters. Returns the problem, or null. */
export function linkProblem(link: string): string | null {
  const value = link.trim();
  if (!value) return "Enter a link, or remove this one.";
  if (value.length > MAX_LINK_LENGTH) return `Links can be up to ${MAX_LINK_LENGTH} characters.`;
  if (!/^https:\/\//i.test(value)) return "Use a link that starts with https://";
  // A host with a dot, and no spaces anywhere.
  if (!/^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(value)) return "Enter a full web address.";
  return null;
}

type FieldErrors = { category?: string; fullName?: string; links: Record<number, string | undefined>; linksAll?: string; idPhoto?: string };
const NO_ERRORS: FieldErrors = { links: {} };

/** The server's field errors ("links.2", "idMediaId") placed beside the matching fields. */
function fieldErrorsFrom(fields: Record<string, string>): FieldErrors {
  const out: FieldErrors = { links: {} };
  for (const [key, message] of Object.entries(fields)) {
    const link = /^links(?:\.|\[)(\d+)\]?$/.exec(key);
    if (link) out.links[Number(link[1])] = message;
    else if (key === "links") out.linksAll = message;
    else if (key === "category") out.category = message;
    else if (key === "fullName") out.fullName = message;
    else if (key === "idMediaId") out.idPhoto = message;
  }
  return out;
}

/** The fix for a reason the server gives, where there's an obvious one. */
function fixFor(reason: string): { label: string; screen: "EditProfile" | "VerifyEmail" } | null {
  if (/email/i.test(reason)) return { label: "Verify email", screen: "VerifyEmail" };
  if (/photo|bio/i.test(reason)) return { label: "Edit profile", screen: "EditProfile" };
  return null;
}

/**
 * Settings > Request verification (also katkee://verification from a notification). Shows where
 * the badge stands, from GET /me/verification: verified (or paused after a name change), a
 * request in review, a denial with the date you can apply again, what's missing before you can
 * apply, or the form. Every badge is checked by hand; the ID photo is seen only by the review
 * team and deleted 30 days after the decision.
 */
export function VerificationScreen({ navigation }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const headerHeight = useHeaderHeight();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  // After a denial, once the wait is over: show the form (or what's missing) again.
  const [reapplying, setReapplying] = useState(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = await getVerification(accessToken);
      setStatus(next);
      setLoadError(null);
      loaded.current = true;
    } catch (e) {
      // A quiet refresh keeps what's on screen.
      if (!loaded.current) setLoadError(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : "Couldn't load your verification status. Check your connection and try again.");
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);
  // Back from Edit profile or Verify email: what's missing may have changed.
  useEffect(() => navigation.addListener("focus", () => {
    if (loaded.current) void load();
  }), [navigation, load]);

  const withdraw = () => {
    Alert.alert("Withdraw request?", "We'll stop reviewing it, and your ID photo is deleted within 30 days. You can apply again later.", [
      { text: "Keep request", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: () => void (async () => {
          if (!accessToken) return;
          setWithdrawing(true);
          setBanner(null);
          try {
            await withdrawVerification(accessToken);
            await load();
          } catch (e) {
            setBanner(e instanceof ApiError ? e.message : "Couldn't withdraw your request. Try again.");
          } finally {
            setWithdrawing(false);
          }
        })(),
      },
    ]);
  };

  if (!status) {
    return loadError ? (
      <LoadFailed message={loadError} onRetry={() => { setLoadError(null); void load(); }} />
    ) : (
      <View style={styles.loading} accessible accessibilityLabel="Loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const request = status.request;
  const reapplyAt = request?.status === "denied" ? request.canReapplyAt : null;
  const waiting = !!reapplyAt && serverTimeMs(reapplyAt) > Date.now();
  let content: React.ReactNode;
  if (status.onHold) {
    content = (
      <StatusCard icon title="Badge paused" body="Your badge is paused while we review your name change." detail={categoryDetail(status.category)} />
    );
  } else if (status.verified) {
    content = (
      <StatusCard
        icon
        title="You're verified"
        body="Your badge shows next to your name across Katkee. Changing your name or username pauses it until we review the change."
        detail={categoryDetail(status.category)}
      />
    );
  } else if (request?.status === "pending") {
    content = (
      <>
        <StatusCard
          title="In review"
          body="We're reviewing your request. We'll let you know when we've decided."
          detail={`Submitted ${verificationDate(request.createdAt)}`}
        />
        <Button label="Withdraw request" variant="destructive" onPress={withdraw} busy={withdrawing} />
      </>
    );
  } else if (request?.status === "denied" && reapplyAt && !reapplying) {
    content = (
      <>
        <StatusCard
          title="Not approved"
          body={request.denialReason || "Your request wasn't approved."}
          detail={`You can apply again on ${verificationDate(reapplyAt)}.`}
        />
        <Button label="Apply again" onPress={() => setReapplying(true)} disabled={waiting} />
      </>
    );
  } else if (!status.eligibility.eligible) {
    content = (
      <View style={styles.section}>
        <Text style={typography.title} accessibilityRole="header">Before you apply</Text>
        <Text style={styles.intro}>Verified accounts belong to notable people, brands and organisations. A few things are needed first:</Text>
        <View style={styles.card}>
          {status.eligibility.reasons.map((reason) => {
            const fix = fixFor(reason);
            return (
              <View key={reason} style={styles.reasonRow}>
                <View style={styles.reasonMark} />
                <Text style={styles.reasonText}>{reason}</Text>
                {fix ? (
                  <Pressable onPress={() => navigation.navigate(fix.screen)} hitSlop={8} style={styles.fix} accessibilityRole="button" accessibilityHint={reason}>
                    <Text style={styles.fixText}>{fix.label}</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    );
  } else {
    content = (
      <RequestForm
        onSubmitted={(next) => {
          setReapplying(false);
          setStatus((current) => (current ? { ...current, request: next } : current));
        }}
        onNotEligible={(reasons) => setStatus((current) => (current ? { ...current, eligibility: { eligible: false, reasons } } : current))}
        onConflict={(message) => {
          setBanner(message);
          void load();
        }}
      />
    );
  }

  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {banner ? <Banner text={banner} /> : null}
        {content}
      </ScrollView>
    </KeyboardAvoider>
  );
}

function categoryDetail(category: string | null): string | undefined {
  const label = verificationCategoryLabel(category);
  return label ? `Category: ${label}` : undefined;
}

function StatusCard({ title, body, detail, icon }: { title: string; body: string; detail?: string; icon?: boolean }): React.JSX.Element {
  return (
    <View style={styles.statusCard}>
      {icon ? <Icon name={ICONS.verified} size={40} color={colors.accent} /> : null}
      <Text style={typography.title} accessibilityRole="header">{title}</Text>
      <Text style={styles.statusBody}>{body}</Text>
      {detail ? <Text style={styles.statusDetail}>{detail}</Text> : null}
    </View>
  );
}

/** The application: category, legal name, links that show who you are, and a photo of your ID. */
function RequestForm({
  onSubmitted,
  onNotEligible,
  onConflict,
}: {
  onSubmitted: (request: NonNullable<VerificationStatus["request"]>) => void;
  onNotEligible: (reasons: string[]) => void;
  onConflict: (message: string) => void;
}): React.JSX.Element {
  const { accessToken } = useAuth();
  const [category, setCategory] = useState<VerificationCategory | null>(null);
  const [fullName, setFullName] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [photo, setPhoto] = useState<{ uri: string; type: string } | null>(null);
  const [photoSheetOpen, setPhotoSheetOpen] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  // Submitting again after a field error doesn't upload the same photo twice.
  const uploaded = useRef<{ uri: string; id: string } | null>(null);

  const setLink = (index: number, value: string) => {
    setLinks((current) => current.map((l, i) => (i === index ? value : l)));
    setErrors((current) => ({ ...current, links: { ...current.links, [index]: undefined }, linksAll: undefined }));
  };
  const removeLink = (index: number) => {
    setLinks((current) => current.filter((_, i) => i !== index));
    setErrors((current) => ({ ...current, links: {}, linksAll: undefined }));
  };

  const takeFrom = async (source: "camera" | "library") => {
    setError(null);
    try {
      if (source === "camera" && Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          cameraRefused();
          return;
        }
      }
      const result: ImagePickerResponse =
        source === "camera"
          ? await launchCamera({ mediaType: "photo", cameraType: "back", saveToPhotos: false, maxWidth: 2048, maxHeight: 2048, quality: 0.9 })
          : await launchImageLibrary({ mediaType: "photo", selectionLimit: 1, assetRepresentationMode: "compatible", maxWidth: 2048, maxHeight: 2048, quality: 0.9 });
      if (result.didCancel) return;
      if (result.errorCode === "permission") {
        if (source === "camera") cameraRefused();
        else setError("Allow access to your photos in Settings to choose a photo.");
        return;
      }
      if (result.errorCode === "camera_unavailable") {
        setError("There's no camera available. Choose a photo instead.");
        return;
      }
      if (result.errorCode) {
        setError(result.errorMessage ?? "Couldn't open that. Try again.");
        return;
      }
      const asset = result.assets?.[0];
      if (asset?.uri) {
        setPhoto({ uri: asset.uri, type: asset.type ?? "image/jpeg" });
        setErrors((current) => ({ ...current, idPhoto: undefined }));
      } else {
        setError("Couldn't read that photo. Try another.");
      }
    } catch {
      setError("Couldn't open that. Try again.");
    }
  };

  const cameraRefused = () => {
    Alert.alert("Allow camera access", "To take a photo of your ID, allow Katkee to use the camera in your phone's Settings.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
    ]);
  };

  const submit = async () => {
    if (!accessToken || inFlight.current) return;
    const name = fullName.trim();
    const cleanLinks = links.map((l) => l.trim());
    const found: FieldErrors = { links: {} };
    if (!category) found.category = "Choose the kind of account this is.";
    if (!name) found.fullName = "Enter your full name as it appears on your ID.";
    cleanLinks.forEach((link, i) => {
      const problem = linkProblem(link);
      if (problem) found.links[i] = problem;
    });
    if (!photo) found.idPhoto = "Add a photo of your ID.";
    if (found.category || found.fullName || found.idPhoto || Object.values(found.links).some(Boolean)) {
      setErrors(found);
      setError("Check the highlighted fields.");
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setErrors(NO_ERRORS);
    setError(null);
    try {
      if (uploaded.current?.uri !== photo!.uri) {
        const media = await uploadPhoto(photo!.uri, photo!.type, accessToken);
        uploaded.current = { uri: photo!.uri, id: media.id };
      }
      const { request } = await requestVerification({ category: category!, fullName: name, links: cleanLinks, idMediaId: uploaded.current.id }, accessToken);
      tapFeedback("success");
      onSubmitted(request);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422 && e.fieldErrors) {
        const next = fieldErrorsFrom(e.fieldErrors);
        // The server didn't take the photo (already used, or gone): choose it again.
        if (next.idPhoto) uploaded.current = null;
        setErrors(next);
        setError("Check the highlighted fields.");
      } else if (e instanceof ApiError && e.status === 403) {
        const reasons = Array.isArray(e.details?.reasons) ? (e.details.reasons as unknown[]).filter((r): r is string => typeof r === "string") : [];
        if (reasons.length) onNotEligible(reasons);
        else setError(e.message);
      } else if (e instanceof ApiError && e.status === 409) {
        onConflict(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't send your request. Check your connection and try again.");
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.intro}>
        A verified badge shows that an account belongs to the notable person, brand or organisation it represents. Our team checks every request by hand.
      </Text>
      {error ? <Banner text={error} /> : null}

      <Text style={styles.label}>Account type</Text>
      <View style={[styles.card, errors.category ? styles.cardError : null]} accessibilityRole="radiogroup">
        {VERIFICATION_CATEGORIES.map((c) => {
          const selected = category === c.value;
          return (
            <Pressable
              key={c.value}
              style={styles.choice}
              onPress={() => {
                setCategory(c.value);
                setErrors((current) => ({ ...current, category: undefined }));
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={c.label}
            >
              <Text style={typography.body}>{c.label}</Text>
              <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <Icon name={ICONS.check} size={14} color={colors.onAccent} /> : null}</View>
            </Pressable>
          );
        })}
      </View>
      {errors.category ? <Text style={styles.error}>{errors.category}</Text> : null}

      <TextField
        label="Full name as on your ID"
        value={fullName}
        onChangeText={(value) => {
          setFullName(value);
          setErrors((current) => ({ ...current, fullName: undefined }));
        }}
        maxLength={MAX_FULL_NAME_LENGTH}
        autoCapitalize="words"
        autoCorrect={false}
        error={errors.fullName}
      />

      <View style={styles.links}>
        <Text style={styles.label}>Links</Text>
        <Text style={styles.hint}>Up to {MAX_VERIFICATION_LINKS} pages that show who you are, such as a website, news articles or other profiles.</Text>
        {links.map((link, index) => (
          <View key={index} style={styles.linkRow}>
            <View style={styles.linkField}>
              <TextField
                label={`Link ${index + 1}`}
                value={link}
                onChangeText={(value) => setLink(index, value)}
                placeholder="https://"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={MAX_LINK_LENGTH}
                error={errors.links[index]}
              />
            </View>
            {links.length > 1 ? (
              <Pressable onPress={() => removeLink(index)} hitSlop={8} style={styles.removeLink} accessibilityRole="button" accessibilityLabel={`Remove link ${index + 1}`}>
                <Icon name={ICONS.close} size={18} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        ))}
        {errors.linksAll ? <Text style={styles.error}>{errors.linksAll}</Text> : null}
        {links.length < MAX_VERIFICATION_LINKS ? (
          <Pressable onPress={() => setLinks((current) => [...current, ""])} style={styles.addLink} hitSlop={6} accessibilityRole="button">
            <Icon name={ICONS.add} size={18} color={colors.accent} />
            <Text style={styles.addLinkText}>Add a link</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.links}>
        <Text style={styles.label}>ID</Text>
        {photo ? (
          <View style={styles.photoRow}>
            <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel="Photo of your ID" accessibilityIgnoresInvertColors />
            <Button label="Change photo" variant="text" onPress={() => setPhotoSheetOpen(true)} disabled={submitting} />
          </View>
        ) : (
          <Pressable onPress={() => setPhotoSheetOpen(true)} style={[styles.addPhoto, errors.idPhoto ? styles.cardError : null]} accessibilityRole="button">
            <Icon name={ICONS.camera} size={20} color={colors.textPrimary} />
            <Text style={styles.addPhotoText}>Add a photo of your ID</Text>
          </Pressable>
        )}
        {errors.idPhoto ? <Text style={styles.error}>{errors.idPhoto}</Text> : null}
        <View style={styles.privacy}>
          <Icon name={ICONS.privacy} size={16} color={colors.textSecondary} />
          <Text style={styles.privacyText}>Only Katkee's review team sees your ID. It's deleted 30 days after we decide.</Text>
        </View>
      </View>

      <Button label="Submit request" onPress={() => void submit()} busy={submitting} />

      <ActionSheet
        visible={photoSheetOpen}
        title="Photo of your ID"
        groups={[[
          { label: "Take photo", onPress: () => void takeFrom("camera") },
          { label: "Choose from library", onPress: () => void takeFrom("library") },
        ]]}
        onClose={() => setPhotoSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  section: { gap: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary },
  label: { ...typography.label, color: colors.textPrimary },
  hint: { ...typography.caption },
  error: { color: colors.danger, fontSize: 13 },
  statusCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  statusBody: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  statusDetail: { ...typography.caption, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  cardError: { borderColor: colors.danger },
  choice: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, paddingHorizontal: spacing.md, gap: spacing.md },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  reasonMark: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.textDisabled },
  reasonText: { ...typography.body, flex: 1 },
  fix: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.sm },
  fixText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  links: { gap: spacing.sm },
  linkRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  linkField: { flex: 1 },
  removeLink: { minHeight: 44, minWidth: 32, marginTop: 22, alignItems: "center", justifyContent: "center" },
  addLink: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 44 },
  addLinkText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
  addPhoto: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  addPhotoText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  photo: { width: 120, height: 80, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  privacy: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  privacyText: { ...typography.caption, flex: 1 },
});
