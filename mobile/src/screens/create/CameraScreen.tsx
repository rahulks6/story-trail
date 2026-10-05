import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {Alert,AppState,Linking, PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import {useIsFocused} from '@react-navigation/native';
import {
  Camera,
  type CameraRef,
  type Recorder,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  usePhotoOutput,
  useVideoOutput,
} from "react-native-vision-camera";
import { launchImageLibrary } from "react-native-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CreateStackParamList } from "../../navigation/types";
import { colors, radii, spacing, ICONS } from "../../theme";
import { useTapGesture } from "../../hooks/useTapGesture";
import { EmptyState } from "../../components/EmptyState";
import { guessMimeTypeFromUri } from "../../utils/mime";

type Props = NativeStackScreenProps<CreateStackParamList, "Camera">;

const MAX_RECORDING_SECONDS = 60;
const RECORD_HOLD_DELAY_MS = 250;
const RECORD_DRAG_ZOOM_SENSITIVITY = 4; // px of vertical drag per 1x of zoom
const ZOOM_INDICATOR_HOLD_MS = 900;

type CameraPosition = "back" | "front";

function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  return Math.sqrt((b.pageX - a.pageX) ** 2 + (b.pageY - a.pageY) ** 2);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Full-screen camera capture (spec section 17): tap for a photo,
 * press-and-hold for video, two-finger pinch-zoom on the preview AND
 * one-finger drag-to-zoom while holding the capture button (spec section
 * 18) with a temporary "Nx" indicator, tap-to-focus/double-tap-to-flip,
 * flash, timer, and gallery import.
 *
 * Both zoom gestures are hand-rolled on core `PanResponder`
 * (`nativeEvent.touches`) rather than `react-native-gesture-handler` — this
 * file used to import that library's `PinchGestureHandler` without it ever
 * being declared in package.json (a real bug: it would have failed to
 * resolve on a real build). The rest of this codebase already proves a
 * dependency-free multitouch pattern works (DraggableCanvasObject.tsx), so
 * this follows it instead of introducing a new native dependency for one
 * screen. Capture uses react-native-vision-camera v5 (photo and video
 * outputs on one session). Photos are JPEG on every platform because the
 * backend accepts JPEG/PNG only; videos are MP4. Device behavior still
 * needs physical-device acceptance (see docs/MANUAL_TEST_PLAN_CAMERA.md).
 */
export function CameraScreen({ navigation }: Props): React.JSX.Element {
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } = useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } = useMicrophonePermission();
  const [position, setPosition] = useState<CameraPosition>("back");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [timerSeconds, setTimerSeconds] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [zoomIndicator, setZoomIndicator] = useState<{ visible: boolean; label: string }>({ visible: false, label: "" });

  const device = useCameraDevice(position);
  const camera = useRef<CameraRef>(null);
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg", quality: 0.9 });
  const videoOutput = useVideoOutput({ enableAudio: hasMicPermission, fileType: "mp4" });
  const recorderRef = useRef<Recorder | null>(null);
  const focused=useIsFocused();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const activeRef=useRef(false);activeRef.current=focused&&foreground;
  const recordingRef=useRef(false),stoppingRef=useRef(false),capturingRef=useRef(false);
  const pendingCapture=useRef<{uri:string;kind:'photo'|'video';width:number|null;height:number|null}|null>(null);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>{activeRef.current=false;sub.remove();};},[]);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const zoomIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef = useRef(1);
  // The preview's own measured size, so the accessible "Focus" action (below)
  // has a real point to focus at — the center of the actual preview, not a
  // guessed constant that would be wrong on a differently-sized device.
  const previewSize = useRef({ width: 0, height: 0 });
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = device?.maxZoom ?? 4;
  useEffect(()=>{setZoom(z=>clamp(z,minZoom,maxZoom));if(!device?.hasFlash)setFlash('off');},[device?.id,minZoom,maxZoom]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!hasCameraPermission) void requestCameraPermission().catch(()=>undefined);
    if (!hasMicPermission) void requestMicPermission().catch(()=>undefined);
  }, [hasCameraPermission, hasMicPermission, requestCameraPermission, requestMicPermission]);

  useEffect(() => {
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      if (zoomIndicatorTimer.current) clearTimeout(zoomIndicatorTimer.current);
    };
  }, []);

  const flashZoomIndicator = useCallback((z: number) => {
    setZoomIndicator({ visible: true, label: `${z.toFixed(1)}x` });
    if (zoomIndicatorTimer.current) clearTimeout(zoomIndicatorTimer.current);
    zoomIndicatorTimer.current = setTimeout(() => setZoomIndicator((v) => ({ ...v, visible: false })), ZOOM_INDICATOR_HOLD_MS);
  }, []);

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = clamp(next, minZoom, maxZoom);
      setZoom(clamped);
      flashZoomIndicator(clamped);
    },
    [minZoom, maxZoom, flashZoomIndicator],
  );

  const goToEditor = useCallback(
    (mediaUri: string, kind: "photo" | "video", width: number | null, height: number | null, mimeType?: string) => {
      if(!activeRef.current){pendingCapture.current={uri:mediaUri,kind,width,height};return;}
      navigation.replace("StoryEditor", {
        mediaUri,
        kind,
        width,
        height,
        mimeType: mimeType ?? guessMimeTypeFromUri(mediaUri, kind),
      });
    },
    [navigation],
  );
  useEffect(()=>{if(focused&&foreground&&pendingCapture.current){const pending=pendingCapture.current;pendingCapture.current=null;goToEditor(pending.uri,pending.kind,pending.width,pending.height);}},[focused,foreground,goToEditor]);

  const takePhoto = useCallback(async () => {
    if (!camera.current||capturingRef.current||recordingRef.current||!activeRef.current) return;
    capturingRef.current=true;
    try{
      for(let remaining=timerSeconds;remaining>0;remaining--){
        setCountdown(remaining);
        await new Promise<void>(resolve=>setTimeout(resolve,1000));
        if(!activeRef.current)return;
      }
      setCountdown(0);
      if(!camera.current||!activeRef.current)return;
      const photo=await photoOutput.capturePhoto({flashMode:device?.hasFlash?flash:'off'},{});
      try{
        // Sensor-native dimensions are landscape for a portrait capture; swap them
        // so the editor sizes the media the way the person framed it.
        const quarterTurn=photo.orientation==='left'||photo.orientation==='right';
        const width=quarterTurn?photo.height:photo.width,height=quarterTurn?photo.width:photo.height;
        const path=await photo.saveToTemporaryFileAsync();
        goToEditor(path.startsWith('file://')?path:`file://${path}`,'photo',width,height,'image/jpeg');
      }finally{photo.dispose();}
    }catch{if(activeRef.current)Alert.alert('Could not take photo','Please try again.');}
    finally{capturingRef.current=false;setCountdown(0);}
  }, [flash, timerSeconds, goToEditor,device?.hasFlash,photoOutput]);

  const finishRecordingState = useCallback(() => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recordingTimer.current = null;
    setIsRecording(false);
    recordingRef.current=false;stoppingRef.current=false;recorderRef.current=null;
  }, []);

  const startRecording = useCallback(() => {
    if (!camera.current || recordingRef.current||capturingRef.current||!activeRef.current) return;
    recordingRef.current=true;
    setIsRecording(true);
    setRecordingSeconds(0);
    recordingTimer.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    void (async () => {
      try{
        // maxDuration is enforced natively, so a stalled JS thread can't overrun the Story limit.
        const recorder=await videoOutput.createRecorder({maxDuration:MAX_RECORDING_SECONDS});
        recorderRef.current=recorder;
        await recorder.startRecording(
          (filePath) => {
            finishRecordingState();
            goToEditor(filePath.startsWith('file://')?filePath:`file://${filePath}`, "video", null, null, 'video/mp4');
          },
          () => {
            finishRecordingState();
            if(activeRef.current)Alert.alert('Could not record video','Please try again.');
          },
        );
        // A release that happened while the recorder was still being created.
        if(stoppingRef.current)await recorder.stopRecording();
      }catch{
        finishRecordingState();
        if(activeRef.current)Alert.alert('Could not start recording','Please try again.');
      }
    })();
  }, [goToEditor,videoOutput,finishRecordingState]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current||stoppingRef.current) return;
    stoppingRef.current=true;
    const recorder=recorderRef.current;
    if(!recorder)return; // startRecording stops it as soon as it exists.
    try{await recorder.stopRecording();}catch{stoppingRef.current=false;if(activeRef.current)Alert.alert('Could not stop recording','Try stopping again.');}
  }, []);
  useEffect(()=>{if(!focused||!foreground)void stopRecording();},[focused,foreground,stopRecording]);

  const openGallery = useCallback(async () => {
    if(recordingRef.current||capturingRef.current)return;
    try{
    // "compatible": iOS exports HEIC photos as JPEG and HEVC video as H.264 — the upload
    // pipeline accepts JPEG/PNG/WebP and MP4/MOV, and iPhones store HEIC by default.
    const result = await launchImageLibrary({ mediaType: "mixed", selectionLimit: 1, assetRepresentationMode: "compatible" });
    if(result.errorCode)throw Error('Gallery unavailable');
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    const kind = asset.type?.startsWith("video") ? "video" : "photo";
    goToEditor(asset.uri, kind, asset.width ?? null, asset.height ?? null, asset.type);
    }catch{if(activeRef.current)Alert.alert('Could not open gallery','Check photo access in Settings and try again.');}
  }, [goToEditor]);

  const onPreviewTap = useTapGesture(
    (x, y) => {
      void camera.current?.focusTo({ x, y }).catch(()=>undefined);
    },
    () => {if(!recordingRef.current&&!capturingRef.current)setPosition((p) => (p === "back" ? "front" : "back"));},
  );

  // A screen reader intercepts the raw touch before the PanResponder below
  // ever sees it, so tap-to-focus otherwise has no accessible equivalent —
  // same reasoning as the capture button's own accessibilityActions.
  // Focuses the center of the actual measured preview rather than an
  // arbitrary point, since that's the one location a non-visual user can
  // reliably mean by "focus the camera."
  const onFocusCenterAccessibilityAction = useCallback(() => {
    const { width, height } = previewSize.current;
    if (width > 0 && height > 0) void camera.current?.focusTo({ x: width / 2, y: height / 2 }).catch(()=>undefined);
  }, []);

  // Two-finger pinch-zoom + single-tap-to-focus/double-tap-to-flip on the
  // full preview — both live on one PanResponder since RN's touch
  // responder negotiation resolves bottom-up (a nested Pressable would
  // claim the touch before this ever saw it), the same reason
  // DraggableGrid's items detect taps inside their own PanResponder.
  const previewGesture = useMemo(() => {
    let pinchActive = false;
    let pinchStartDistance = 0;
    let pinchStartZoom = 1;
    let tapStart = { x: 0, y: 0, locationX: 0, locationY: 0 };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;
        pinchActive = false;
        if (touches.length >= 2) {
          const [a, b] = touches;
          pinchActive = true;
          pinchStartDistance = touchDistance(a, b);
          pinchStartZoom = zoomRef.current;
        } else {
          tapStart = {
            x: evt.nativeEvent.pageX,
            y: evt.nativeEvent.pageY,
            locationX: evt.nativeEvent.locationX,
            locationY: evt.nativeEvent.locationY,
          };
        }
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (!pinchActive) {
            const [a, b] = touches;
            pinchActive = true;
            pinchStartDistance = touchDistance(a, b);
            pinchStartZoom = zoomRef.current;
            return;
          }
          const [a, b] = touches;
          const currentDistance = touchDistance(a, b);
          const factor = pinchStartDistance > 0 ? currentDistance / pinchStartDistance : 1;
          applyZoom(pinchStartZoom * factor);
        }
      },
      onPanResponderRelease: (evt: GestureResponderEvent) => {
        if (pinchActive) {
          pinchActive = false;
          return;
        }
        const dx = evt.nativeEvent.pageX - tapStart.x;
        const dy = evt.nativeEvent.pageY - tapStart.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return; // a pan, not a tap
        onPreviewTap(tapStart.locationX, tapStart.locationY);
      },
      onPanResponderTerminate: () => {
        pinchActive = false;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyZoom, onPreviewTap]);

  // One-finger record-and-vertical-drag-to-zoom, scoped to the capture
  // button itself so nothing else on the preview can be misread as this
  // gesture while actually recording (spec: "nothing else should interpret
  // that motion"). A hold past RECORD_HOLD_DELAY_MS starts recording,
  // exactly like the old onLongPress; a release before that is a photo tap.
  const captureGesture = useMemo(() => {
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let recordingStarted = false;
    let dragStartY = 0;
    let dragStartZoom = 1;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        recordingStarted = false;
        dragStartY = evt.nativeEvent.pageY;
        dragStartZoom = zoomRef.current;
        holdTimer = setTimeout(() => {
          recordingStarted = true;
          startRecording();
        }, RECORD_HOLD_DELAY_MS);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        if (!recordingStarted) return;
        const dy = dragStartY - evt.nativeEvent.pageY; // dragging up = zoom in
        applyZoom(dragStartZoom + dy / RECORD_DRAG_ZOOM_SENSITIVITY);
      },
      onPanResponderRelease: () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (recordingStarted) {
          void stopRecording();
        } else {
          void takePhoto();
        }
      },
      onPanResponderTerminate: () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (recordingStarted) void stopRecording();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startRecording, stopRecording, takePhoto, applyZoom]);

  if (!hasCameraPermission) {
    return <View style={styles.container}><EmptyState title="Camera access needed" message="Enable camera access in Settings, or choose media from your gallery."/><Pressable style={styles.sideButton} onPress={()=>void Linking.openSettings().catch(()=>undefined)}><Text style={{color:colors.textPrimary}}>Open Settings</Text></Pressable><Pressable style={styles.sideButton} onPress={()=>void openGallery()}><Text style={{color:colors.textPrimary}}>Choose from gallery</Text></Pressable></View>;
  }
  if (!device) {
    return <EmptyState title="No camera available" message="This device doesn't have a usable camera." />;
  }

  return (
    <View style={styles.container}>
      <View
        style={StyleSheet.absoluteFill}
        {...previewGesture.panHandlers}
        onLayout={(e) => {
          previewSize.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
        }}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Camera preview"
        accessibilityHint="Use the actions menu to focus the camera or flip it"
        accessibilityActions={[
          { name: "focus", label: "Focus camera" },
          { name: "activate", label: "Flip camera" },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "focus") onFocusCenterAccessibilityAction();
          else if (event.nativeEvent.actionName === "activate" && !recordingRef.current && !capturingRef.current) setPosition((p) => (p === "back" ? "front" : "back"));
        }}
      >
        <Camera
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={focused&&foreground}
          outputs={[photoOutput, videoOutput]}
          zoom={zoom}
          torchMode={isRecording && flash === "on" && device.hasTorch ? "on" : "off"}
          onError={() => { if (activeRef.current) Alert.alert("Camera unavailable", "Close the camera and try again."); }}
        />
      </View>

      {zoomIndicator.visible ? (
        <View style={styles.zoomBadge} accessibilityLiveRegion="polite">
          <Text style={styles.zoomBadgeLabel}>Zoom {zoomIndicator.label}</Text>
        </View>
      ) : null}

      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close camera">
          <Icon style={styles.topIcon} name={ICONS.close} />
        </Pressable>
        <View style={styles.topRight}>
          <Pressable
            disabled={!device.hasFlash||isRecording}
            onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Flash"
            accessibilityState={{ selected: flash === "on" }}
          >
            <Icon style={[styles.topIcon, flash === "on" && styles.topIconActive]} name={ICONS.flash} />
          </Pressable>
          <Pressable
            onPress={() => setTimerSeconds((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))}
            hitSlop={12}
            style={styles.timerButton}
            accessibilityRole="button"
            accessibilityLabel={timerSeconds === 0 ? "Timer off" : `Timer, ${timerSeconds} seconds`}
          >
            <Icon name="timer" style={[styles.topIcon, timerSeconds > 0 && styles.topIconActive]}/><Text style={styles.topIcon}>{timerSeconds > 0 ? `${timerSeconds}s` : ""}</Text>
          </Pressable>
        </View>
      </View>

      {countdown > 0 ? (
        <View style={styles.countdown} pointerEvents="none" accessibilityLiveRegion="assertive">
          <Text style={styles.countdownLabel} accessibilityLabel={`Taking photo in ${countdown}`}>{countdown}</Text>
        </View>
      ) : null}

      {isRecording ? (
        <View style={styles.recordingBadge}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
            {String(recordingSeconds % 60).padStart(2, "0")}
          </Text>
        </View>
      ) : null}

      <View style={styles.bottomBar}>
        {!hasMicPermission&&<Text style={{color:colors.textPrimary}}>Microphone off</Text>}
        <Pressable onPress={openGallery} hitSlop={12} style={styles.sideButton} accessibilityRole="button" accessibilityLabel="Choose from gallery">
          <Icon style={styles.sideButtonIcon} name={ICONS.gallery} />
        </Pressable>

        {/*
          The gesture itself (tap=photo, hold+drag=record-and-zoom) can be
          unreachable under a screen reader, which intercepts raw touches
          for its own navigation — accessibilityActions gives VoiceOver/
          TalkBack a real, non-gesture path to the same two outcomes via
          their standard activate gesture and actions menu, not just a label
          on an otherwise-inaccessible control.
        */}
        <View
          {...captureGesture.panHandlers}
          style={[styles.captureButton, isRecording && styles.captureButtonRecording]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={isRecording ? "Recording — activate to stop" : "Take photo"}
          accessibilityHint={isRecording ? undefined : "Use the actions menu to record video instead"}
          accessibilityActions={[
            { name: "activate", label: isRecording ? "Stop recording" : "Take photo" },
            { name: "longpress", label: "Record video" },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "activate") {
              if (isRecording) void stopRecording();
              else void takePhoto();
            } else if (event.nativeEvent.actionName === "longpress" && !isRecording) {
              startRecording();
            }
          }}
        />

        <Pressable
          disabled={isRecording}
          onPress={() => { if (!recordingRef.current && !capturingRef.current) setPosition((p) => (p === "back" ? "front" : "back")); }}
          hitSlop={12}
          style={styles.sideButton}
          accessibilityRole="button"
          accessibilityLabel="Flip camera"
        >
          <Icon style={styles.sideButtonIcon} name={ICONS.flip} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  topBar: {
    position: "absolute",
    top: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topRight: { flexDirection: "row", gap: spacing.lg },
  topIcon: { color: colors.textPrimary, fontSize: 20, fontWeight: "600" },
  topIconActive: { color: colors.accent },
  timerButton: { minWidth: 40 },
  zoomBadge: {
    position: "absolute",
    alignSelf: "center",
    top: "45%",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  zoomBadgeLabel: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
  recordingBadge: {
    position: "absolute",
    top: spacing.xl,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  recordingText: { color: colors.textPrimary, fontWeight: "600" },
  bottomBar: {
    position: "absolute",
    bottom: spacing.xl,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
  },
  sideButton: { width: 56, alignItems: "center" },
  sideButtonIcon: { color: colors.textPrimary, fontSize: 24 },
  captureButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.textPrimary,
    backgroundColor: "transparent",
  },
  captureButtonRecording: { backgroundColor: colors.danger, borderColor: colors.danger },
  countdown: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  countdownLabel: { color: colors.textPrimary, fontSize: 96, fontWeight: "700" },
});
