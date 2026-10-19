import { NativeModules } from "react-native";

/**
 * The Jest preset's native Animated module ends every native-driver animation after 16ms. Story
 * progress bars run on the native driver, so tests that depend on how long a Story stays up make
 * those animations last their real duration (timing animations reach native as 60fps frames) and
 * stop when stopped.
 */
export function timeNativeAnimations(): void {
  const module = NativeModules.NativeAnimatedModule as {
    startAnimatingNode: jest.Mock;
    stopAnimation: jest.Mock;
  };
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  module.startAnimatingNode.mockImplementation((id: number, _tag: number, config: { frames?: unknown[] }, end: (r: { finished: boolean }) => void) => {
    const ms = Array.isArray(config?.frames) ? (config.frames.length * 1000) / 60 : 16;
    timers.set(id, setTimeout(() => { timers.delete(id); end({ finished: true }); }, ms));
  });
  module.stopAnimation.mockImplementation((id: number) => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  });
}
