// Preview harness: the app's real creator-page screens rendered with React Native for Web and
// sample data, for screenshots. Not part of the app.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ProfileScreen } from "../../../mobile/src/screens/profile/ProfileScreen";
import { UserProfileScreen } from "../../../mobile/src/screens/profile/UserProfileScreen";
import { BottomTabBar } from "../../../mobile/src/navigation/BottomTabBar";
import { EditProfileScreen } from "../../../mobile/src/screens/profile/EditProfileScreen";
import { AvatarCropper } from "../../../mobile/src/components/AvatarCropper";
import { LoginScreen } from "../../../mobile/src/screens/auth/LoginScreen";
import { AboutScreen } from "../../../mobile/src/screens/profile/AboutScreen";
import { samplePhoto } from "./mocks/images";
import { Icon } from "../../../mobile/src/components/Icon";
import { colors } from "../../../mobile/src/theme";

const screen = new URLSearchParams(location.search).get("screen") ?? "own";

function StatusBar() {
  return (
    <View style={styles.status}>
      <Text style={styles.statusText}>9:41</Text>
      <View style={styles.island} />
      <Text style={styles.statusText}>100%</Text>
    </View>
  );
}

function Tabs() {
  const names = ["Home", "Search", "Create", "Activity", "DM", "Profile"];
  const routes = names.map((name) => ({ key: name, name }));
  const state = { index: screen === "own" ? 5 : 1, routes } as any;
  const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: { tabBarAccessibilityLabel: r.name } }])) as any;
  const navigation = { emit: () => ({ defaultPrevented: false }), navigate() {} } as any;
  return <BottomTabBar state={state} descriptors={descriptors} navigation={navigation} insets={{ top: 0, bottom: 34, left: 0, right: 0 }} />;
}

/** The native stack header the Search stack draws above someone's page. */
function OtherPage({ username }: { username: string }) {
  const [options, setOptions] = useState<{ title?: string; headerRight?: () => React.ReactNode }>({});
  // React Navigation hands a screen the same navigation object on every render.
  const [navigation] = useState(() => ({ setOptions: (o: object) => setOptions((prev) => ({ ...prev, ...o })), goBack() {}, navigate() {} }));
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.headerSide}><Icon name="back" size={22} color={colors.textPrimary} /></Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{options.title ?? ""}</Text>
        <View style={[styles.headerSide, { alignItems: "flex-end" }]}>{options.headerRight ? options.headerRight() : null}</View>
      </View>
      <UserProfileScreen navigation={navigation as never} route={{ key: "u", name: "UserProfile", params: { username } } as never} />
    </View>
  );
}

/** Edit Profile under the root stack's header. */
function EditPage() {
  const navigation = { goBack() {}, dispatch() {}, navigate() {}, setOptions() {} };
  return (
    <View style={{ flex: 1 }}>
      <StatusBar />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.headerSide}><Icon name="back" size={22} color={colors.textPrimary} /></Pressable>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.headerSide} />
      </View>
      <EditProfileScreen navigation={navigation as never} route={{ key: "e", name: "EditProfile" } as never} />
    </View>
  );
}

/** About under the root stack's header. */
function AboutPage() {
  return (
    <View style={{ flex: 1 }}>
      <StatusBar />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.headerSide}><Icon name="back" size={22} color={colors.textPrimary} /></Pressable>
        <Text style={styles.headerTitle}>About</Text>
        <View style={styles.headerSide} />
      </View>
      <AboutScreen />
    </View>
  );
}

function Phone() {
  if (screen === "login") return <View style={styles.phone}><LoginScreen navigation={{ navigate() {} } as never} route={{ key: "l", name: "Login" } as never} /></View>;
  if (screen === "about") return <View style={styles.phone}><AboutPage /></View>;
  if (screen === "edit") return <View style={styles.phone}><EditPage /></View>;
  if (screen === "crop") return <View style={styles.phone}><AvatarCropper photo={{ uri: samplePhoto, width: 1200, height: 900 }} onCancel={() => {}} onDone={() => {}} /></View>;
  return (
    <View style={styles.phone}>
      {screen !== "own" ? <StatusBar /> : null}
      <View style={{ flex: 1 }}>
        {screen === "own" ? <ProfileScreen /> : <OtherPage username={screen === "private" ? "kabir.s" : "asha_k"} />}
      </View>
      <Tabs />
    </View>
  );
}

const styles = StyleSheet.create({
  phone: { width: 390, height: 844, backgroundColor: colors.background, overflow: "hidden" },
  status: { height: 47, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 28, backgroundColor: colors.background },
  statusText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  island: { width: 120, height: 34, borderRadius: 17, backgroundColor: "#000" },
  header: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, backgroundColor: colors.background },
  headerSide: { width: 60 },
  headerTitle: { flex: 1, textAlign: "center", color: colors.textPrimary, fontSize: 17, fontWeight: "600" },
});

createRoot(document.getElementById("root")!).render(<Phone />);
