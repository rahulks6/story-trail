import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "../components/Pressable";
import { Icon } from "../components/Icon";
import { Avatar } from "../components/Avatar";
import { VerifiedName } from "../components/VerifiedBadge";
import { mediaColors, mediaTypography, radii, spacing, ICONS } from "../theme";
import type { IconName } from "../theme/icons";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { callStatusText, isLive, type CallState } from "./callMachine";
import type { CallControls } from "./CallContext";
import { webRtc, type StreamLike } from "./webrtc";
import { t } from "../i18n";

/** The call screen is always dark, like the camera and Stories: faces and video read best on black. */
const c = mediaColors;
// Answer green: a white icon on it reaches 4.2:1, and it stands out from black at 4.7:1. The pill's
// deeper green carries white text at 5.9:1 (WCAG AA).
const ANSWER_GREEN = "#1E8E3E";
const PILL_GREEN = "#137333";

interface Props {
  state: CallState;
  controls: CallControls;
  local: StreamLike | null;
  remote: StreamLike | null;
}

/** Re-renders every second while the call runs, so the timer counts. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** A round control with its label under it, like the phone's own call screen. */
function CallButton({ icon, label, onPress, active = false, tone = "plain", size = 64, accessibilityLabel }: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** On (muted, loudspeaker): drawn light, like a pressed key. */
  active?: boolean;
  tone?: "plain" | "danger" | "answer";
  size?: number;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const background = tone === "danger" ? c.danger : tone === "answer" ? ANSWER_GREEN : active ? c.textPrimary : "rgba(255,255,255,0.16)";
  const ink = tone === "plain" && active ? c.background : "#FFFFFF";
  return (
    <View style={styles.buttonColumn}>
      <Pressable
        onPress={onPress}
        style={[styles.button, { width: size, height: size, borderRadius: size / 2, backgroundColor: background }]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={tone === "plain" ? { selected: active } : undefined}
        hitSlop={6}
      >
        <Icon name={icon} size={Math.round(size * 0.42)} color={ink} />
      </Pressable>
      <Text style={styles.buttonLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** The photo grows and fades in rings while it rings (still, with Reduce Motion on). */
function RingingAvatar({ state, size }: { state: CallState; size: number }): React.JSX.Element {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const ringing = state.phase === "incoming" || state.phase === "outgoing";
  useEffect(() => {
    if (!ringing || reduced) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced, ringing]);
  const peer = state.peer;
  return (
    <View style={{ width: size * 1.6, height: size * 1.6, alignItems: "center", justifyContent: "center" }}>
      {ringing && !reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.pulse, { width: size, height: size, borderRadius: size / 2, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }] }]}
        />
      ) : null}
      {peer ? <Avatar username={peer.username} displayName={peer.displayName} avatarMediaId={peer.avatarMediaId} size={size} /> : <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]} />}
    </View>
  );
}

/** The minimized call: a pill over the app; a tap brings the call screen back. */
function CallPill({ state, controls }: { state: CallState; controls: CallControls }): React.JSX.Element {
  const { top } = useSafeAreaInsets();
  const now = useNow(state.phase === "active");
  const status = callStatusText(state, now);
  const name = state.peer?.displayName || (state.peer ? `@${state.peer.username}` : t("call.call"));
  return (
    <View style={[styles.pillWrap, { top: top + spacing.xs }]} pointerEvents="box-none">
      <Pressable
        onPress={controls.restore}
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel={(state.media === "video" ? t("call.videoCallWithNameStatus", { name, status }) : t("call.callWithNameStatus", { name, status }))}
        accessibilityHint={t("call.returnsToTheCall")}
      >
        <Icon name={state.media === "video" ? ICONS.video : ICONS.call} size={16} color="#FFFFFF" />
        <Text style={styles.pillText} numberOfLines={1}>{name} · {status}</Text>
      </Pressable>
    </View>
  );
}

/**
 * The full-screen call: incoming (Decline / Accept), outgoing ("Calling…", "Ringing…"), and the
 * call itself (timer, mute, loudspeaker, camera, flip, hang up), with the other person's video
 * full screen and yours in a small window. Shown over everything; minimized, it becomes a pill
 * and the app is usable underneath.
 */
export function CallScreen({ state, controls, local, remote }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const live = isLive(state);
  const now = useNow(state.phase === "active");
  if (state.minimized) return <CallPill state={state} controls={controls} />;

  const video = state.media === "video";
  const VideoView = webRtc()?.VideoView ?? null;
  const showRemote = video && !!remote && !!VideoView && state.remoteCameraOn && (state.phase === "active" || state.phase === "reconnecting");
  const showLocal = video && !!local && !!VideoView && state.cameraOn && !state.backgrounded && state.phase !== "ended";
  // Before the other person's video arrives, your own camera fills the screen (as on the way in).
  const localFull = showLocal && !showRemote && state.phase !== "incoming";
  const name = state.peer?.displayName || state.peer?.username || "";
  const status = callStatusText(state, now);
  const toggleLabel = (on: boolean, what: string) => (on ? t("call.turnOffWhat", { what }) : t("call.turnOnWhat", { what }));

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => (live && state.phase !== "incoming" ? controls.minimize() : undefined)}>
      <StatusBar barStyle="light-content" />
      <View style={styles.screen} accessibilityViewIsModal>
        {showRemote && VideoView ? <VideoView streamURL={remote!.toURL()} objectFit="cover" zOrder={0} style={StyleSheet.absoluteFill} /> : null}
        {localFull && VideoView ? <VideoView streamURL={local!.toURL()} objectFit="cover" mirror={state.frontCamera} zOrder={0} style={StyleSheet.absoluteFill} /> : null}
        {showRemote || localFull ? <View style={[StyleSheet.absoluteFill, styles.scrim]} pointerEvents="none" /> : null}

        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
          {live && state.phase !== "incoming" ? (
            <Pressable onPress={controls.minimize} hitSlop={10} style={styles.minimize} accessibilityRole="button" accessibilityLabel={t("call.minimizeCall")} accessibilityHint={t("call.keepsTheCallGoingWhile")}>
              <Icon name={ICONS.down} size={22} color="#FFFFFF" />
            </Pressable>
          ) : <View style={styles.minimize} />}
        </View>

        <View style={[styles.identity, showRemote && styles.identityCompact]}>
          {showRemote ? null : <RingingAvatar state={state} size={120} />}
          <VerifiedName name={name} verified={state.peer?.verified} style={styles.name} />
          <Text style={[styles.status, state.phase === "reconnecting" && styles.statusWarning]} accessibilityLiveRegion="polite" accessibilityRole="text">
            {status}
          </Text>
          {live && !state.remoteMicrophoneOn ? <Text style={styles.note}>{(state.peer?.displayName ? t("call.displaynameMutedTheirMicrophone", { displayName: state.peer?.displayName }) : t("call.theyMutedTheirMicrophone"))}</Text> : null}
          {live && video && !state.remoteCameraOn && (state.phase === "active" || state.phase === "reconnecting") ? <Text style={styles.note}>{t("call.theirCameraIsOff")}</Text> : null}
        </View>

        {showLocal && !localFull && VideoView ? (
          <View style={[styles.pip, { top: insets.top + spacing.xxl + spacing.sm }]} accessible accessibilityLabel={t("call.yourCamera")}>
            <VideoView streamURL={local!.toURL()} objectFit="cover" mirror={state.frontCamera} zOrder={1} style={StyleSheet.absoluteFill} />
          </View>
        ) : null}

        <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.xl }]}>
          {state.phase === "incoming" ? (
            <View style={styles.row}>
              <CallButton icon={ICONS.endCall} label={t("common.decline")} tone="danger" size={72} onPress={controls.decline} accessibilityLabel={t("call.declineCall")} />
              <CallButton icon={video ? ICONS.video : ICONS.call} label={t("common.accept")} tone="answer" size={72} onPress={controls.accept} accessibilityLabel={video ? t("call.acceptVideoCall") : t("call.acceptCall")} />
            </View>
          ) : live ? (
            <>
              <View style={styles.row}>
                {video ? <CallButton icon={ICONS.flip} label={t("call.flip")} onPress={controls.flipCamera} accessibilityLabel={t("call.switchCamera")} /> : null}
                {video ? <CallButton icon={state.cameraOn ? ICONS.video : ICONS.videoOff} label={t("call.camera")} active={!state.cameraOn} onPress={controls.toggleCamera} accessibilityLabel={toggleLabel(state.cameraOn, "camera")} /> : null}
                <CallButton icon={state.microphoneOn ? ICONS.mic : ICONS.micOff} label={state.microphoneOn ? t("call.mute") : t("common.unmute")} active={!state.microphoneOn} onPress={controls.toggleMicrophone} accessibilityLabel={state.microphoneOn ? t("call.muteMicrophone") : t("call.unmuteMicrophone")} />
                <CallButton icon={ICONS.audioOn} label={t("call.speaker")} active={state.speakerOn} onPress={controls.toggleSpeaker} accessibilityLabel={toggleLabel(state.speakerOn, "loudspeaker")} />
              </View>
              <View style={styles.row}>
                <CallButton icon={ICONS.endCall} label={t("call.end")} tone="danger" size={72} onPress={controls.hangUp} accessibilityLabel={t("call.endCall")} />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  scrim: { backgroundColor: "rgba(0,0,0,0.25)" },
  top: { flexDirection: "row", paddingHorizontal: spacing.md },
  minimize: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  identity: { alignItems: "center", marginTop: spacing.xl, paddingHorizontal: spacing.lg },
  identityCompact: { marginTop: spacing.sm },
  pulse: { position: "absolute", backgroundColor: c.textPrimary },
  placeholder: { backgroundColor: c.surfaceElevated },
  name: { ...mediaTypography.displayLarge, marginTop: spacing.md, textAlign: "center" },
  status: { ...mediaTypography.body, color: c.textSecondary, marginTop: spacing.xs, fontVariant: ["tabular-nums"] },
  statusWarning: { color: c.accentText },
  note: { ...mediaTypography.caption, marginTop: spacing.xs },
  pip: { position: "absolute", right: spacing.md, width: 108, height: 160, borderRadius: radii.md, overflow: "hidden", backgroundColor: c.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  controls: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, gap: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "flex-start" },
  buttonColumn: { alignItems: "center", minWidth: 72 },
  button: { alignItems: "center", justifyContent: "center" },
  buttonLabel: { ...mediaTypography.caption, color: "#FFFFFF", marginTop: spacing.sm },
  pillWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: PILL_GREEN, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.pill, maxWidth: "90%", minHeight: 40 },
  pillText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", flexShrink: 1, fontVariant: ["tabular-nums"] },
});
