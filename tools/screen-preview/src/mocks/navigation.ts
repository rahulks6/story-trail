import { useEffect } from "react";
export const nav = { navigate() {}, setOptions() {}, goBack() {}, getParent() { return { addListener: () => () => undefined }; } };
export function useNavigation() { return nav; }
export function useFocusEffect(effect: () => void | (() => void)) { useEffect(() => effect(), [effect]); }
export function usePreventRemove() {}
