import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import Svg, { Circle } from "react-native-svg";
import { Icon } from "../../components/Icon";
import { tapFeedback } from '../../utils/haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {ActivityIndicator,Alert,AppState,Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
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
import { mediaColors as colors, radii, spacing, ICONS } from "../../theme";
import { reportHandledError } from "../../crashReporting";
import { useTapGesture } from "../../hooks/useTapGesture";
import { EmptyState } from "../../components/EmptyState";
import { guessMimeTypeFromUri } from "../../utils/mime";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { BOOMERANG_RECORD_MS, CAPTURE_MODES, shutterLabel, shutterTap, type CaptureMode, type MediaEffect } from "../../models/captureModes";

type Props = NativeStackScreenProps<CreateStackParamList, "Camera">;

const MAX_RECORDING_SECONDS = 60;
/** The shutter's size, and the recording ring just inside its edge. */
const SHUTTER = 80;
const RING_RADIUS = SHUTTER / 2 - 3;
/** The gap between the shutter's top and the mode row above it. */
const MODE_ROW_GAP = spacing.sm + spacing.xs;
/** The upload limits (state/uploadQueue.ts): said before editing rather than after. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const RECORD_HOLD_DELAY_MS = 250;
/** Dragging up this far while recording doubles the zoom (gradual, like Instagram). */
const RECORD_DRAG_PX_PER_DOUBLING = 180;
/** Beyond this, digital zoom is just blur. */
const MAX_USEFUL_ZOOM = 10;
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
 * flash, timer, and gallery import. A mode row above the shutter adds
 * Hands-free (tap to start, tap to stop) and Boomerang (one tap records a
 * short burst; the server loops it forward and back), see models/captureModes.
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
const VIDEO_BIT_RATE = 6_000_000;

export function CameraScreen({ navigation }: Props): React.JSX.Element {
  useMediaStatusBar();
  const insets = useScreenInsets();
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } = useCameraPermission();
  const { hasPermission: hasMicPermission, requestPermission: requestMicPermission } = useMicrophonePermission();
  const [position, setPosition] = useState<CameraPosition>("back");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [timerSeconds, setTimerSeconds] = useState<0 | 3 | 10>(0);
  const [countdown, setCountdown] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [zoomIndicator, setZoomIndicator] = useState<{ visible: boolean; label: string }>({ visible: false, label: "" });
  const [mode, setMode] = useState<CaptureMode>("normal");
  const modeRef = useRef<CaptureMode>("normal");
  modeRef.current = mode;
  const boomerangTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const device = useCameraDevice(position);
  // Cameras are listed a moment after the screen opens: wait before saying there's none.
  const [cameraSearchOver, setCameraSearchOver] = useState(false);
  useEffect(() => {
    if (device) return;
    const timer = setTimeout(() => setCameraSearchOver(true), 3000);
    return () => clearTimeout(timer);
  }, [device]);
  const camera = useRef<CameraRef>(null);
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg", quality: 0.9 });
  // Sound is decided once both permission questions are answered, so the camera isn't rebuilt
  // mid-session when the microphone answer arrives (a likely cause of "Camera unavailable").
  const [permissionsSettled, setPermissionsSettled] = useState(hasCameraPermission && hasMicPermission);
  const [audioEnabled, setAudioEnabled] = useState(hasMicPermission);
  // 1080p at 6 Mbit/s: Stories are shown at 720p, and the phone's own default (often 15–20
  // Mbit/s) makes a minute of video a 120 MB upload on mobile data.
  const videoOutput = useVideoOutput({ enableAudio: audioEnabled, fileType: "mp4", targetBitRate: VIDEO_BIT_RATE });
  // A camera error first restarts the camera quietly; only repeated errors are shown.
  const outputs = useMemo(() => [photoOutput, videoOutput], [photoOutput, videoOutput]);
  const [cameraKey, setCameraKey] = useState(0);
  const cameraErrors = useRef<number[]>([]);
  const recorderRef = useRef<Recorder | null>(null);
  const focused=useIsFocused();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  const activeRef=useRef(false);activeRef.current=focused&&foreground;
  const recordingRef=useRef(false),stoppingRef=useRef(false),capturingRef=useRef(false);
  const pendingCapture=useRef<{uri:string;kind:'photo'|'video';width:number|null;height:number|null;mimeType?:string;effect:MediaEffect}|null>(null);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>{activeRef.current=false;sub.remove();};},[]);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const zoomIndicatorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef = useRef(1);
  // The preview's own measured size, so the accessible "Focus" action (below)
  // has a real point to focus at — the center of the actual preview, not a
  // guessed constant that would be wrong on a differently-sized device.
  const previewSize = useRef({ width: 0, height: 0 });
  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 4, MAX_USEFUL_ZOOM);
  // A different camera starts at its normal zoom.
  useEffect(()=>{zoomRef.current=clamp(1,minZoom,maxZoom);if(!device?.hasFlash)setFlash('off');},[device?.id,minZoom,maxZoom]);

  // One question at a time (Android shows one permission prompt at a time): camera, then microphone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const camOk = hasCameraPermission || (await requestCameraPermission().catch(() => false));
      const micOk = hasMicPermission || (camOk ? await requestMicPermission().catch(() => false) : false);
      if (cancelled) return;
      setAudioEnabled(!!micOk);
      setPermissionsSettled(true);
    })();
    return () => { cancelled = true; };
    // Asked once when the camera opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The microphone allowed later (in Settings, while the camera stayed open): record with sound
  // from the next video on. Not mid-recording, which would rebuild the video output under it.
  useEffect(() => {
    if (permissionsSettled && hasMicPermission && !audioEnabled && !isRecording) setAudioEnabled(true);
  }, [permissionsSettled, hasMicPermission, audioEnabled, isRecording]);

  // The torch is set only once the camera is running: a torch (or zoom) command sent before
  // that is refused with "Camera is not active", which showed "Camera unavailable" every time.
  const [cameraStarted, setCameraStarted] = useState(false);
  const torchOn = isRecording && flash === "on" && !!device?.hasTorch;
  useEffect(() => {
    if (!cameraStarted) return;
    void camera.current?.controller?.setTorchMode(torchOn ? "on" : "off").catch(() => undefined);
  }, [cameraStarted, torchOn]);

  const onCameraError = useCallback((error: Error) => {
    if (!activeRef.current) return;
    // A command that reached the camera while it was starting or stopping: harmless, not a failure.
    if (/not active|OperationCanceled/i.test(error?.message ?? "")) return;
    const now = Date.now();
    cameraErrors.current = [...cameraErrors.current.filter((t) => now - t < 10_000), now];
    if (cameraErrors.current.length <= 2) {
      // Restart the camera; most errors (a busy camera, an interrupted session) clear on a restart.
      setCameraKey((k) => k + 1);
      return;
    }
    cameraErrors.current = [];
    // The technical detail goes to crash reports (Admin > Crashes), not into the message.
    reportHandledError(error ?? new Error("Camera error"));
    Alert.alert("Camera unavailable", "Close the camera and open it again. If it keeps happening, restart your phone.");
  }, []);

  useEffect(() => {
    return () => {
      if (recordingTimer.current) clearInterval(recordingTimer.current);
      if (zoomIndicatorTimer.current) clearTimeout(zoomIndicatorTimer.current);
      if (boomerangTimer.current) clearTimeout(boomerangTimer.current);
    };
  }, []);

  const flashZoomIndicator = useCallback((z: number) => {
    setZoomIndicator({ visible: true, label: `${z.toFixed(1)}x` });
    if (zoomIndicatorTimer.current) clearTimeout(zoomIndicatorTimer.current);
    zoomIndicatorTimer.current = setTimeout(() => setZoomIndicator((v) => ({ ...v, visible: false })), ZOOM_INDICATOR_HOLD_MS);
  }, []);

  // Zoom goes straight to the camera once per screen frame, without re-rendering the screen:
  // sending every finger movement through React state is what made it stutter.
  const zoomFrame = useRef<number | null>(null);
  useEffect(() => () => { if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current); }, []);
  const applyZoom = useCallback(
    (next: number) => {
      zoomRef.current = clamp(next, minZoom, maxZoom);
      if (zoomFrame.current !== null) return;
      zoomFrame.current = requestAnimationFrame(() => {
        zoomFrame.current = null;
        const z = zoomRef.current;
        void camera.current?.controller?.setZoom(z).catch(() => undefined);
        flashZoomIndicator(z);
      });
    },
    [minZoom, maxZoom, flashZoomIndicator],
  );

  const goToEditor = useCallback(
    (mediaUri: string, kind: "photo" | "video", width: number | null, height: number | null, mimeType?: string, effect: MediaEffect = "none") => {
      if(!activeRef.current){pendingCapture.current={uri:mediaUri,kind,width,height,mimeType,effect};return;}
      navigation.replace("StoryEditor", {
        mediaUri,
        kind,
        width,
        height,
        mimeType: mimeType ?? guessMimeTypeFromUri(mediaUri, kind),
        ...(effect === "boomerang" ? { effect } : {}),
      });
    },
    [navigation],
  );
  useEffect(()=>{if(focused&&foreground&&pendingCapture.current){const pending=pendingCapture.current;pendingCapture.current=null;goToEditor(pending.uri,pending.kind,pending.width,pending.height,pending.mimeType,pending.effect);}},[focused,foreground,goToEditor]);

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
      tapFeedback('tap');
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
    if (boomerangTimer.current) clearTimeout(boomerangTimer.current);
    boomerangTimer.current = null;
    setIsRecording(false);
    recordingRef.current=false;stoppingRef.current=false;recorderRef.current=null;
  }, []);

  const stopRecordingRef = useRef<() => Promise<void>>(async () => undefined);
  const startRecording = useCallback((effect: MediaEffect = "none") => {
    if (!camera.current || recordingRef.current||capturingRef.current||!activeRef.current) return;
    recordingRef.current=true;
    setIsRecording(true);
    tapFeedback('tap');
    setRecordingSeconds(0);
    recordingTimer.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    void (async () => {
      try{
        // maxDuration is enforced natively, so a stalled JS thread can't overrun the Story limit
        // (or a Boomerang's short burst).
        const recorder=await videoOutput.createRecorder({maxDuration:effect==='boomerang'?3:MAX_RECORDING_SECONDS});
        recorderRef.current=recorder;
        await recorder.startRecording(
          (filePath) => {
            finishRecordingState();
            goToEditor(filePath.startsWith('file://')?filePath:`file://${filePath}`, "video", null, null, 'video/mp4', effect);
          },
          () => {
            finishRecordingState();
            if(activeRef.current)Alert.alert('Could not record video','Please try again.');
          },
        );
        // A release that happened while the recorder was still being created.
        if(stoppingRef.current)await recorder.stopRecording();
        // A Boomerang is a short burst: it stops itself.
        else if(effect==='boomerang')boomerangTimer.current=setTimeout(()=>void stopRecordingRef.current(),BOOMERANG_RECORD_MS);
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
  stopRecordingRef.current = stopRecording;

  // A quick tap on the shutter (or a screen reader's activate), in whichever mode is chosen.
  const onShutterTap = useCallback(() => {
    const action = shutterTap(modeRef.current, recordingRef.current);
    if (action === "photo") void takePhoto();
    else if (action === "start") startRecording();
    else if (action === "boomerang") startRecording("boomerang");
    else if (action === "stop") void stopRecording();
  }, [takePhoto, startRecording, stopRecording]);
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
    // Too big to upload: say so now, not after the Story has been edited.
    const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
    if (typeof asset.fileSize === "number" && asset.fileSize > limit) {
      Alert.alert(
        kind === "video" ? "Video too large" : "Photo too large",
        `Stories can be up to ${Math.round(limit / (1024 * 1024))} MB. ${kind === "video" ? "Trim the video or choose a shorter one." : "Choose a smaller photo."}`,
      );
      return;
    }
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
  // Created once; calls the latest functions through this ref. Recording re-renders the screen,
  // and rebuilding the handlers mid-hold lost the release, so recording might not stop.
  const cg = useRef({ startRecording, stopRecording, onShutterTap, applyZoom });
  cg.current = { startRecording, stopRecording, onShutterTap, applyZoom };
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
        // Only Normal records on a hold; the other modes act on the tap itself.
        if (modeRef.current !== "normal") return;
        holdTimer = setTimeout(() => {
          recordingStarted = true;
          cg.current.startRecording();
        }, RECORD_HOLD_DELAY_MS);
      },
      onPanResponderMove: (evt: GestureResponderEvent) => {
        if (!recordingStarted) return;
        const dy = dragStartY - evt.nativeEvent.pageY; // dragging up = zoom in
        cg.current.applyZoom(dragStartZoom * Math.pow(2, dy / RECORD_DRAG_PX_PER_DOUBLING));
      },
      onPanResponderRelease: () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (recordingStarted) {
          void cg.current.stopRecording();
        } else {
          cg.current.onShutterTap();
        }
      },
      onPanResponderTerminate: () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
        if (recordingStarted) void cg.current.stopRecording();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeButton = (
    <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={[styles.toolButton, styles.closeCorner, { top: insets.top + spacing.md }]} accessibilityRole="button" accessibilityLabel="Close camera">
      <Icon style={styles.topIcon} name={ICONS.close} />
    </Pressable>
  );
  if (!hasCameraPermission) {
    return (
      <View style={styles.container}>
        <EmptyState variant="media" icon="camera" title="Camera access needed" message="Turn on camera access in Settings, or post a photo or video from your gallery.">
          <View style={styles.emptyActions}>
            <Pressable accessibilityRole="button" style={[styles.emptyButton, styles.emptyButtonPrimary]} onPress={() => void Linking.openSettings().catch(() => undefined)}>
              <Text style={[styles.emptyButtonLabel, styles.emptyButtonPrimaryLabel]}>Open Settings</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.emptyButton} onPress={() => void openGallery()}>
              <Text style={styles.emptyButtonLabel}>Choose from gallery</Text>
            </Pressable>
          </View>
        </EmptyState>
        {closeButton}
      </View>
    );
  }
  if (!device) {
    return (
      <View style={styles.container}>
        {cameraSearchOver ? (
          <EmptyState variant="media" icon="camera" title="No camera available" message="You can still post a photo or video from your gallery.">
            <Pressable accessibilityRole="button" style={styles.emptyButton} onPress={() => void openGallery()}>
              <Text style={styles.emptyButtonLabel}>Choose from gallery</Text>
            </Pressable>
          </EmptyState>
        ) : (
          <ActivityIndicator style={styles.cameraLoading} color={colors.textPrimary} accessibilityLabel="Starting camera" />
        )}
        {closeButton}
      </View>
    );
  }
  if (!permissionsSettled) {
    return <View style={styles.container} />;
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
          key={cameraKey}
          ref={camera}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={focused&&foreground}
          outputs={outputs}
          onStarted={() => setCameraStarted(true)}
          onStopped={() => setCameraStarted(false)}
          onError={onCameraError}
        />
      </View>

      {zoomIndicator.visible ? (
        <View style={styles.zoomBadge} accessibilityLiveRegion="polite">
          <Text style={styles.zoomBadgeLabel}>Zoom {zoomIndicator.label}</Text>
        </View>
      ) : null}

      <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="Close camera">
          <Icon style={styles.topIcon} name={ICONS.close} />
        </Pressable>
        <View style={styles.topRight}>
          <Pressable
            disabled={!device.hasFlash||isRecording}
            onPress={() => setFlash((f) => (f === "off" ? "on" : "off"))}
            hitSlop={8}
            style={[styles.toolButton, !device.hasFlash && styles.toolDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Flash"
            accessibilityState={{ selected: flash === "on" }}
          >
            <Icon style={[styles.topIcon, flash === "on" && styles.topIconActive]} name={ICONS.flash} />
          </Pressable>
          <Pressable
            onPress={() => setTimerSeconds((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))}
            hitSlop={8}
            style={[styles.toolButton, styles.timerButton]}
            accessibilityRole="button"
            accessibilityLabel={timerSeconds === 0 ? "Timer off" : `Timer, ${timerSeconds} seconds`}
          >
            <Icon name="timer" style={[styles.topIcon, timerSeconds > 0 && styles.topIconActive]}/>{timerSeconds > 0 ? <Text style={styles.timerLabel}>{`${timerSeconds}s`}</Text> : null}
          </Pressable>
        </View>
      </View>

      {!hasMicPermission && !isRecording ? (
        <Pressable onPress={() => void Linking.openSettings().catch(() => undefined)} style={[styles.micNote, { top: insets.top + spacing.md + 52 }]} accessibilityRole="button" accessibilityLabel="Microphone off. Videos record without sound. Open Settings to allow it.">
          <Icon name={ICONS.audioMuted} size={14} color={colors.textPrimary} />
          <Text style={styles.micNoteLabel}>Microphone off · videos have no sound</Text>
        </Pressable>
      ) : null}

      {countdown > 0 ? (
        <View style={styles.countdown} pointerEvents="none" accessibilityLiveRegion="assertive">
          <Text style={styles.countdownLabel} accessibilityLabel={`Taking photo in ${countdown}`}>{countdown}</Text>
        </View>
      ) : null}

      {isRecording ? (
        <View style={[styles.recordingBadge, { top: insets.top + spacing.md }]}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>
            {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
            {String(recordingSeconds % 60).padStart(2, "0")}
          </Text>
        </View>
      ) : null}

      {!isRecording ? (
        // Scrolls sideways when large text doesn't fit; centred when it does.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.modeRow, { bottom: spacing.xl + insets.bottom + SHUTTER + MODE_ROW_GAP }]}
          contentContainerStyle={styles.modeRowContent}
          accessibilityRole="radiogroup"
          accessibilityLabel="Camera mode"
        >
          {CAPTURE_MODES.map((m) => (
            <Pressable
              key={m.mode}
              onPress={() => {
                if (recordingRef.current || capturingRef.current || m.mode === mode) return;
                tapFeedback("select");
                setMode(m.mode);
              }}
              hitSlop={8}
              style={[styles.modeChip, m.mode === mode && styles.modeChipActive]}
              accessibilityRole="radio"
              accessibilityLabel={m.label}
              accessibilityHint={m.hint}
              accessibilityState={{ selected: m.mode === mode }}
            >
              <Text style={[styles.modeLabel, m.mode === mode && styles.modeLabelActive]} numberOfLines={1}>{m.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={[styles.bottomBar, { bottom: spacing.xl + insets.bottom }]}>
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
          style={[styles.captureButton, mode === "boomerang" && styles.captureButtonBoomerang, isRecording && styles.captureButtonRecording]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={shutterLabel(mode, isRecording)}
          accessibilityHint={isRecording || mode !== "normal" ? undefined : "Use the actions menu to record video instead"}
          accessibilityActions={[
            { name: "activate", label: shutterLabel(mode, isRecording) },
            ...(mode === "normal" ? [{ name: "longpress", label: "Record video" }] : []),
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "activate") onShutterTap();
            else if (event.nativeEvent.actionName === "longpress" && !isRecording && mode === "normal") startRecording();
          }}
        >
          {/* Like Instagram: a white disc in a ring; while recording, the ring fills as time runs out. */}
          {isRecording ? (
            <Svg width={SHUTTER} height={SHUTTER} style={StyleSheet.absoluteFill} pointerEvents="none">
              <Circle
                cx={SHUTTER / 2}
                cy={SHUTTER / 2}
                r={RING_RADIUS}
                stroke={mode === "boomerang" ? colors.accent : colors.danger}
                strokeWidth={5}
                fill="none"
                strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
                strokeDashoffset={RING_LENGTH * (1 - Math.min(1, recordingSeconds / (mode === "boomerang" ? 2 : MAX_RECORDING_SECONDS)))}
                strokeLinecap="round"
                transform={`rotate(-90 ${SHUTTER / 2} ${SHUTTER / 2})`}
              />
            </Svg>
          ) : null}
          <View pointerEvents="none" style={[styles.shutterDisc, mode === "boomerang" && styles.shutterDiscBoomerang, isRecording && styles.shutterDiscRecording]} />
        </View>

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
  closeCorner: { position: "absolute", left: spacing.md, zIndex: 1 },
  cameraLoading: { flex: 1 },
  topIcon: { color: colors.textPrimary, fontSize: 24, fontWeight: "600" },
  toolDisabled: { opacity: 0.4 },
  timerLabel: { color: colors.accent, fontSize: 14, fontWeight: "700" },
  topIconActive: { color: colors.accent },
  timerButton: { minWidth: 42, flexDirection: "row", gap: 2 },
  toolButton: { minWidth: 42, height: 42, paddingHorizontal: 9, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
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
  sideButton: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  sideButtonIcon: { color: colors.textPrimary, fontSize: 26 },
  captureButton: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 5,
    borderColor: colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
  },
  captureButtonBoomerang: { borderColor: colors.accent },
  captureButtonRecording: { borderColor: "rgba(255,255,255,0.35)" },
  shutterDisc: { width: SHUTTER - 18, height: SHUTTER - 18, borderRadius: (SHUTTER - 18) / 2, backgroundColor: colors.textPrimary },
  shutterDiscBoomerang: { backgroundColor: colors.accent },
  // Recording: the disc becomes a small red square, like Instagram's stop button.
  shutterDiscRecording: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.danger },
  micNote: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.5)" },
  micNoteLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: "600" },
  modeRow: { position: "absolute", left: 0, right: 0, flexGrow: 0 },
  modeRowContent: { flexGrow: 1, flexDirection: "row", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  modeChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.35)" },
  modeChipActive: { backgroundColor: colors.textPrimary },
  modeLabel: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
  modeLabelActive: { color: "#000" },
  countdown: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  countdownLabel: { color: colors.textPrimary, fontSize: 96, fontWeight: "700" },
  emptyActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.md },
  emptyButton: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: colors.textPrimary },
  emptyButtonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  emptyButtonLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  emptyButtonPrimaryLabel: { color: colors.onAccent },
});
