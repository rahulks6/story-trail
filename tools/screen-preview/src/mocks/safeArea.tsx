import React from "react";
export const insets = { top: 47, bottom: 34, left: 0, right: 0 };
export function useSafeAreaInsets() { return insets; }
export function SafeAreaProvider({ children }: { children: React.ReactNode }) { return <>{children}</>; }
export function SafeAreaView({ children, style }: any) { return <div style={style}>{children}</div>; }
