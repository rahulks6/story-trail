import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./Icon";
import { colors, radii, spacing, ICONS } from "../theme";
import {
  avatarCropRect, avatarImageLayout, initialAvatarCrop, panAvatarCrop, zoomAvatarCrop, type AvatarCrop,
} from "../models/avatarCrop";
import { cropSquarePhoto } from "../utils/cropPhoto";

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

interface Props {
  photo: PickedPhoto | null;
  onCancel: () => void;
  /** The cut, square JPEG, ready to preview and upload. */
  onDone: (uri: string) => void;
}

const touchDistance = (touches: GestureResponderEvent["nativeEvent"]["touches"]) =>
  Math.hypot(touches[1]!.pageX - touches[0]!.pageX, touches[1]!.pageY - touches[0]!.pageY);

/**
 * Move and scale a new profile photo inside a circle (Phase 11): drag to move, pinch or use the
 * buttons to zoom. The square is cut on the phone, so the rest of the photo is never uploaded.
 */
export function AvatarCropper({ photo, onCancel, onDone }: Props): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const viewport = Math.min(screenWidth - spacing.lg * 2, 420);
  const [crop, setCrop] = useState<AvatarCrop | null>(null);
  const [working, setWorking] = useState(false);
  const gesture = useRef<{ start: AvatarCrop; pinch: number } | null>(null);
  const shown = photo && crop ? crop : photo ? initialAvatarCrop(photo.width, photo.height) : null;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          if (!shownRef.current) return;
          const touches = event.nativeEvent.touches;
          gesture.current = { start: shownRef.current, pinch: touches.length >= 2 ? touchDistance(touches) : 0 };
        },
        onPanResponderMove: (event, state) => {
          const current = gesture.current;
          if (!current || !photo) return;
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            const distance = touchDistance(touches);
            if (current.pinch === 0) {
              gesture.current = { start: shownRef.current ?? current.start, pinch: distance };
              return;
            }
            setCrop(zoomAvatarCrop(current.start, distance / current.pinch, photo.width, photo.height));
            return;
          }
          if (current.pinch !== 0) {
            // A finger lifted mid-pinch: carry on as a drag from here.
            gesture.current = { start: shownRef.current ?? current.start, pinch: 0 };
            return;
          }
          setCrop(panAvatarCrop(current.start, state.dx, state.dy, viewport, photo.width, photo.height));
        },
        onPanResponderRelease: () => {
          gesture.current = null;
        },
      }),
    [photo, viewport],
  );

  if (!photo || !shown) return null;
  const layout = avatarImageLayout(shown, photo.width, photo.height, viewport);
  const zoomBy = (factor: number) => setCrop(zoomAvatarCrop(shown, factor, photo.width, photo.height));
  const close = () => {
    if (working) return;
    setCrop(null);
    onCancel();
  };
  const usePhoto = async () => {
    if (working) return;
    setWorking(true);
    try {
      const uri = await cropSquarePhoto(photo.uri, avatarCropRect(shown, photo.width, photo.height));
      setCrop(null);
      onDone(uri);
    } catch {
      Alert.alert("Couldn't use this photo", "Try another photo.");
    } finally {
      setWorking(false);
    }
  };
  const r = viewport / 2;
  // The whole square, minus the circle: darkens what won't be in the photo.
  const mask = `M0 0H${viewport}V${viewport}H0Z M${r} 0A${r} ${r} 0 1 0 ${r} ${viewport}A${r} ${r} 0 1 0 ${r} 0Z`;

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.bar}>
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text style={styles.barButton}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">Move and scale</Text>
          <Pressable onPress={() => void usePhoto()} hitSlop={8} disabled={working} accessibilityRole="button" accessibilityLabel="Use photo" accessibilityState={{ busy: working, disabled: working }}>
            {working ? <ActivityIndicator color={colors.accent} /> : <Text style={[styles.barButton, styles.barPrimary]}>Use photo</Text>}
          </Pressable>
        </View>

        <View style={styles.middle}>
          <View
            style={[styles.viewport, { width: viewport, height: viewport }]}
            {...responder.panHandlers}
            accessible
            accessibilityLabel="Photo: drag to move it, pinch to zoom"
          >
            <Image source={{ uri: photo.uri }} style={[styles.photo, layout]} resizeMode="stretch" />
            <Svg width={viewport} height={viewport} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Path d={mask} fill="rgba(0,0,0,0.6)" fillRule="evenodd" />
            </Svg>
            <View pointerEvents="none" style={[styles.circle, { width: viewport, height: viewport, borderRadius: r }]} />
          </View>
          <Text style={styles.hint}>Drag to move. Pinch to zoom.</Text>
          <View style={styles.zoomRow}>
            <Pressable style={styles.zoomButton} onPress={() => zoomBy(1 / 1.25)} accessibilityRole="button" accessibilityLabel="Zoom out">
              <Icon name={ICONS.minus} size={20} color={colors.textPrimary} />
            </Pressable>
            <Pressable style={styles.zoomButton} onPress={() => zoomBy(1.25)} accessibilityRole="button" accessibilityLabel="Zoom in">
              <Icon name={ICONS.add} size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, minHeight: 44 },
  barButton: { color: colors.textPrimary, fontSize: 16 },
  barPrimary: { color: colors.accent, fontWeight: "700" },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: "700" },
  middle: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  viewport: { overflow: "hidden", backgroundColor: colors.surface },
  photo: { position: "absolute" },
  circle: { position: "absolute", left: 0, top: 0, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)" },
  hint: { color: colors.textSecondary, fontSize: 13 },
  zoomRow: { flexDirection: "row", gap: spacing.lg },
  zoomButton: { width: 48, height: 48, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center" },
});
