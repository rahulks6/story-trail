import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import type { CallMedia, CallPerson } from "../api/calls";
import { useAuth } from "../state/AuthContext";
import { useRealtimeEvents } from "../state/RealtimeContext";
import { onForegroundPush } from "../push/pushNotifications";
import { callIdFromLink } from "../navigation/profileLinks";
import { showToast } from "../components/Toast";
import { tapFeedback } from "../utils/haptics";
import { CallController } from "./CallController";
import { callReducer, IDLE, isLive, type CallAction, type CallState } from "./callMachine";
import { webRtc, type StreamLike } from "./webrtc";
import { CallScreen } from "./CallScreen";

/** How long "Call ended" (or "Declined", "No answer") stays up before the screen closes. */
const ENDED_SCREEN_MS = 1_600;

export interface CallControls {
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
  toggleMicrophone: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
  flipCamera: () => void;
  minimize: () => void;
  restore: () => void;
}

interface CallContextValue {
  state: CallState;
  /** Whether this build can place calls at all (the native WebRTC module is linked). */
  supported: boolean;
  /** Calls someone from your 1:1 chat with them. */
  startCall: (conversationId: string, media: CallMedia, peer: CallPerson | null) => void;
  /** A ringing call's push was tapped (katkee://call/<id>). */
  openCallLink: (url: string) => boolean;
  controls: CallControls;
}

const CallContext = createContext<CallContextValue | null>(null);

/**
 * Microphone (and camera, for video) first, asked in context as the call starts. Bluetooth
 * (Android 12+) only routes the call to a headset: refusing it doesn't stop the call. iOS asks
 * when the call opens the microphone itself.
 */
async function callPermissions(media: CallMedia): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const needed = media === "video" ? [P.RECORD_AUDIO, P.CAMERA] : [P.RECORD_AUDIO];
  const optional = Number(Platform.Version) >= 31 && P.BLUETOOTH_CONNECT ? [P.BLUETOOTH_CONNECT] : [];
  try {
    const result = await PermissionsAndroid.requestMultiple([...needed, ...optional]);
    return needed.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

function permissionRefused(media: CallMedia): void {
  Alert.alert(
    media === "video" ? "Allow camera and microphone" : "Allow microphone",
    media === "video"
      ? "To make video calls, allow Katkee to use the camera and microphone in your phone's Settings."
      : "To make calls, allow Katkee to use the microphone in your phone's Settings.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
    ],
  );
}

/**
 * One-to-one calls for the whole app: listens for incoming calls (realtime events while the app
 * is open, the push's link when it was tapped), runs the call (CallController.ts), and shows the
 * full-screen call screen over everything, or a pill while it's minimized.
 */
export function CallProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { status, user, accessToken } = useAuth();
  const userId = status === "signedIn" ? user?.id ?? null : null;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const stateRef = useRef<CallState>(IDLE);
  const [state, setState] = useState<CallState>(IDLE);
  const [streams, setStreams] = useState<{ local: StreamLike | null; remote: StreamLike | null }>({ local: null, remote: null });
  const controller = useRef<CallController | null>(null);
  const supported = webRtc() !== null;

  // The controller reads the state it just changed, so the store is a ref first and React's copy second.
  const dispatch = useCallback((action: CallAction) => {
    const next = callReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const newController = useCallback((): CallController | null => {
    const rtc = webRtc();
    if (!rtc || !userId) return null;
    const created = new CallController({
      rtc,
      myUserId: userId,
      token: () => tokenRef.current,
      dispatch,
      getState: () => stateRef.current,
      onStreams: (local, remote) => setStreams({ local, remote }),
    });
    controller.current = created;
    return created;
  }, [dispatch, userId]);

  const busy = () => isLive(stateRef.current) || (controller.current !== null && !controller.current.isFinished);

  const startCall = useCallback((conversationId: string, media: CallMedia, peer: CallPerson | null) => {
    if (busy()) {
      if (stateRef.current.minimized) dispatch({ type: "restore" });
      else showToast("You're already on a call.");
      return;
    }
    tapFeedback("tap");
    void (async () => {
      if (!(await callPermissions(media))) {
        permissionRefused(media);
        return;
      }
      if (busy()) return;
      const created = newController();
      if (!created) {
        showToast("Calls aren't available on this phone yet.");
        return;
      }
      await created.place(conversationId, media, peer);
      if (stateRef.current.endedBecause === "permission") permissionRefused(media);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, newController]);

  const receive = useCallback((callId: string) => {
    if (controller.current?.callId === callId) {
      if (stateRef.current.minimized) dispatch({ type: "restore" });
      return;
    }
    if (busy()) return; // the caller hears "busy" from the server
    void newController()?.receive(callId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, newController]);

  const openCallLink = useCallback((url: string) => {
    const id = callIdFromLink(url);
    if (!id) return false;
    receive(id);
    return true;
  }, [receive]);

  useRealtimeEvents((event) => {
    if (event.type === "call") {
      if (event.state === "ringing" && event.calleeId === userId && !event.ringing && controller.current?.callId !== event.callId) receive(event.callId);
      else controller.current?.onCallEvent(event);
    } else if (event.type === "call_signal") {
      controller.current?.onSignalEvent(event.callId);
    } else if (event.type === "resync") {
      controller.current?.onResync();
    }
  });

  // The ringing push while the app is open (the realtime connection may still be reconnecting).
  useEffect(() => onForegroundPush((notice) => {
    const id = callIdFromLink(notice.url);
    if (id) receive(id);
  }), [receive]);

  // Sound carries on in the background; the camera pauses (CallController.setBackground).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" || next === "background") controller.current?.setBackground(next === "background");
    });
    return () => subscription.remove();
  }, []);

  // Signed out mid-call: the call ends with the session.
  useEffect(() => {
    if (userId) return;
    void controller.current?.hangUp();
    controller.current = null;
  }, [userId]);

  // "Call ended" for a moment, then the screen closes.
  useEffect(() => {
    if (state.phase !== "ended") return;
    tapFeedback("success");
    const timer = setTimeout(() => {
      dispatch({ type: "reset" });
      controller.current = null;
    }, ENDED_SCREEN_MS);
    return () => clearTimeout(timer);
  }, [dispatch, state.phase]);

  const controls = useMemo<CallControls>(() => ({
    accept: () => { tapFeedback("success"); void controller.current?.accept(); },
    decline: () => { tapFeedback("tap"); void controller.current?.decline(); },
    hangUp: () => { tapFeedback("tap"); void controller.current?.hangUp(); },
    toggleMicrophone: () => { tapFeedback("select"); controller.current?.toggleMicrophone(); },
    toggleCamera: () => { tapFeedback("select"); controller.current?.toggleCamera(); },
    toggleSpeaker: () => { tapFeedback("select"); controller.current?.toggleSpeaker(); },
    flipCamera: () => { tapFeedback("select"); controller.current?.flipCamera(); },
    minimize: () => dispatch({ type: "minimize" }),
    restore: () => dispatch({ type: "restore" }),
  }), [dispatch]);

  const value = useMemo<CallContextValue>(() => ({ state, supported, startCall, openCallLink, controls }), [controls, openCallLink, startCall, state, supported]);
  return (
    <CallContext.Provider value={value}>
      {children}
      {state.phase !== "idle" ? <CallScreen state={state} controls={controls} local={streams.local} remote={streams.remote} /> : null}
    </CallContext.Provider>
  );
}

export function useCalls(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCalls must be used within a CallProvider");
  return ctx;
}

/** For screens that may render outside the provider (tests): null there. */
export function useCallsIfAvailable(): CallContextValue | null {
  return useContext(CallContext);
}
