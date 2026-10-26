import {AccountSecurityScreen} from "../screens/profile/AccountSecurityScreen";
import {UploadQueueScreen} from '../screens/create/UploadQueueScreen';
import {AppealsScreen} from '../screens/profile/AppealsScreen';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { createNavigationContainerRef, DarkTheme, DefaultTheme, NavigationContainer, type LinkingOptions, type Theme } from "@react-navigation/native";
import { InAppNotificationBanner } from "../components/InAppNotificationBanner";
import { colorScheme } from "../theme/colors";
import { deepLinkTarget, LINK_PREFIXES, linkPath, opensInApp } from "./profileLinks";
import { initialNotificationLink, onNotificationOpened } from "../push/pushNotifications";
import { usePushRegistration } from "../push/usePushRegistration";
import { useAreaSync } from "../state/nearby";
import { NearbyPrompt } from "../components/NearbyPrompt";
import { useAnalytics } from "../analytics/useAnalytics";
import { StoryLinkScreen } from "../screens/story/StoryLinkScreen";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AuthStackParamList, RootStackParamList } from "./types";
import { colors } from "../theme";
import { useAuth } from "../state/AuthContext";
import { AuthNavigator } from "./AuthNavigator";
import { MainTabs } from "./MainTabs";
import { StoryViewerScreen } from "../screens/story/StoryViewerScreen";
import { HighlightViewerScreen } from "../screens/highlight/HighlightViewerScreen";
import { HighlightEditorScreen } from "../screens/highlight/HighlightEditorScreen";
import { ArchiveScreen } from "../screens/profile/ArchiveScreen";
import { SequenceInsightsScreen } from "../screens/profile/SequenceInsightsScreen";
import { ArchivedStoryViewerScreen } from "../screens/profile/ArchivedStoryViewerScreen";
import { EditProfileScreen } from "../screens/profile/EditProfileScreen";
import { SettingsScreen } from "../screens/profile/SettingsScreen";
import { NotificationSettingsScreen } from "../screens/profile/NotificationSettingsScreen";
import { HelpScreen } from "../screens/profile/HelpScreen";
import { AboutScreen } from "../screens/profile/AboutScreen";
import { FollowRequestsScreen } from "../screens/profile/FollowRequestsScreen";
import { VerifyEmailScreen } from "../screens/auth/VerifyEmailScreen";
import { OnboardingScreen } from "../screens/onboarding/OnboardingScreen";
import { needsOnboarding, OnboardingProvider } from "../state/onboarding";
import { BlockedAccountsScreen } from "../screens/profile/BlockedAccountsScreen";
import { MutedAccountsScreen } from "../screens/profile/MutedAccountsScreen";
import { CloseFriendsScreen } from "../screens/profile/CloseFriendsScreen";
import { FollowListScreen } from "../screens/profile/FollowListScreen";
import { VerificationScreen } from "../screens/profile/VerificationScreen";
import { ActivityScreen } from "../screens/activity/ActivityScreen";
import { UploadRunner } from "../state/UploadRunner";
import { FeedbackScreen } from "../screens/profile/FeedbackScreen";
import { SendStoryScreen } from "../screens/dm/SendStoryScreen";
import { ForwardScreen } from "../screens/dm/ForwardScreen";
import { setCurrentScreen } from "../crashReporting";
import { MEDIA_TRANSITION, PUSH_TRANSITION } from "./transitions";

/** The screen on view, deepest navigator first (crash reports say where they happened). */
export function focusedRouteName(state: { index?: number; routes: Array<{ name: string; state?: unknown }> } | undefined): string | undefined {
  let current = state;
  let name: string | undefined;
  while (current?.routes?.length) {
    const route = current.routes[current.index ?? current.routes.length - 1];
    if (!route) break;
    name = route.name;
    current = route.state as typeof current;
  }
  return name;
}

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * StoryViewer lives at the root, above the tabs, so any screen (Profile,
 * Search results, later Home's story tray) can open it the same way,
 * regardless of which tab's stack it was tapped from.
 */
function SignedInNavigator({ onboarding }: { onboarding: boolean }): React.JSX.Element {
  const { user, justSignedUp } = useAuth();
  // A new account sees only "Verify your email" until the code is entered; once it is, the
  // full app replaces it. (Older accounts can verify later, from their profile.)
  if (user?.emailVerificationRequired) {
    return (
      <Stack.Navigator key="verify-email" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      </Stack.Navigator>
    );
  }
  // First run, once verified: interests and people to follow (OnboardingScreen) before Home.
  if (onboarding) {
    return (
      <Stack.Navigator key="onboarding" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      </Stack.Navigator>
    );
  }
  const verifyFirst = justSignedUp && !!user?.email && user.emailVerified === false;
  return (
    <Stack.Navigator initialRouteName={verifyFirst ? "VerifyEmail" : "Main"} screenOptions={{ ...PUSH_TRANSITION, headerShown: false, freezeOnBlur: true, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
      <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} options={{headerShown:true,title:"Account security",headerStyle:{backgroundColor:colors.background},headerTintColor:colors.textPrimary}}/>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen name="Activity" component={ActivityScreen} />
      <Stack.Screen name="UploadQueue" component={UploadQueueScreen} options={{headerShown:true,title:'Story uploads',headerStyle:{backgroundColor:colors.background},headerTintColor:colors.textPrimary}}/>
      <Stack.Screen name="Appeals" component={AppealsScreen} options={{headerShown:true,title:'Account review',headerStyle:{backgroundColor:colors.background},headerTintColor:colors.textPrimary}}/>
      <Stack.Screen name="StoryViewer" component={StoryViewerScreen} options={MEDIA_TRANSITION} />
      <Stack.Screen name="SendStory" component={SendStoryScreen} options={{ presentation: "modal", headerShown: true, title: "Send to", headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
      <Stack.Screen name="ForwardMessage" component={ForwardScreen} options={{ presentation: "modal", headerShown: true, title: "Forward to", headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.textPrimary, headerShadowVisible: false }} />
      <Stack.Screen name="StoryLink" component={StoryLinkScreen} options={MEDIA_TRANSITION} />
      <Stack.Screen name="HighlightViewer" component={HighlightViewerScreen} options={MEDIA_TRANSITION} />
      <Stack.Screen
        name="HighlightEditor"
        component={HighlightEditorScreen}
        options={({ route }) => ({
          headerShown: true,
          title: route.params.highlightId ? "Edit Highlight" : "New Highlight",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        })}
      />
      <Stack.Screen
        name="Archive"
        component={ArchiveScreen}
        options={{
          headerShown: true,
          title: "Archive",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="SequenceInsights"
        component={SequenceInsightsScreen}
        options={{
          headerShown: true,
          title: "Insights",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="ArchivedStoryViewer"
        component={ArchivedStoryViewerScreen}
        options={MEDIA_TRANSITION}
      />
      <Stack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{
          headerShown: true,
          title: "Edit profile",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          headerShown: true,
          title: "Settings",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="NotificationSettings"
        component={NotificationSettingsScreen}
        options={{
          headerShown: true,
          title: "Notifications",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="Help"
        component={HelpScreen}
        options={{
          headerShown: true,
          title: "Help",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="Feedback"
        component={FeedbackScreen}
        options={{
          headerShown: true,
          title: "Send feedback",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{
          headerShown: true,
          title: "About",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="FollowRequests"
        component={FollowRequestsScreen}
        options={{
          headerShown: true,
          title: "Follow requests",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="BlockedAccounts"
        component={BlockedAccountsScreen}
        options={{
          headerShown: true,
          title: "Blocked accounts",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="MutedAccounts"
        component={MutedAccountsScreen}
        options={{
          headerShown: true,
          title: "Muted accounts",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="CloseFriends"
        component={CloseFriendsScreen}
        options={{
          headerShown: true,
          title: "Close Friends",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="Verification"
        component={VerificationScreen}
        options={{
          headerShown: true,
          title: "Request verification",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <Stack.Screen
        name="FollowList"
        component={FollowListScreen}
        options={({ route }) => ({
          headerShown: true,
          title: route.params.mode === "followers" ? "Followers" : "Following",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        })}
      />
    </Stack.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  const { status, user } = useAuth();
  // null while checking; asked again for each account that signs in.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const userId = status === "signedIn" ? user?.id ?? null : null;
  useEffect(() => {
    setOnboarding(null);
    if (!userId || !user) return;
    let alive = true;
    void needsOnboarding(user).then((needed) => { if (alive) setOnboarding(needed); });
    return () => { alive = false; };
    // Checked once per account; finishing onboarding or a profile edit doesn't re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  const onboardingControl = useMemo(() => ({ finish: () => setOnboarding(false) }), []);
  usePushRegistration();
  useAreaSync();
  useAnalytics();
  const pendingLink = useRef<string | null>(null);
  const navigationRef = useMemo(() => createNavigationContainerRef<RootStackParamList>(), []);
  // The linking listener below, so a tapped in-app banner opens its link like a tapped notification.
  const openLink = useRef<((url: string) => void) | null>(null);
  // A profile or Story link that arrives while signed out opens after sign-in.
  useEffect(() => {
    if (status === "signedIn") return;
    const subscription = Linking.addEventListener("url", ({url}) => {
      const path = linkPath(url);
      const target = path === null ? null : deepLinkTarget(path);
      if (target && target.kind !== "resetPassword" && opensInApp(url)) pendingLink.current = url;
    });
    return () => subscription.remove();
  }, [status]);
  const linking = useMemo<LinkingOptions<RootStackParamList>>(() => ({
    prefixes: LINK_PREFIXES,
    getInitialURL: async () => {
      const url = pendingLink.current ?? await Linking.getInitialURL() ?? await initialNotificationLink();
      pendingLink.current = null;
      return url && opensInApp(url) ? url : null;
    },
    // Links opened from outside, plus taps on push notifications while the app runs.
    subscribe: listener => {
      openLink.current = listener;
      const links = Linking.addEventListener("url", ({ url }) => { if (opensInApp(url)) listener(url); });
      const stopNotifications = onNotificationOpened(listener);
      return () => {
        links.remove();
        stopNotifications();
        openLink.current = null;
      };
    },
    getStateFromPath: path => {
      const target = deepLinkTarget(path);
      if (target?.kind === "profile") {
        const params = target.userId ? { username: target.username, userId: target.userId } : { username: target.username };
        // Search's own first screen sits under the profile, so the Search tab still works afterwards.
        return { routes: [{name: "Main", state: {routes: [{name: "Search", state: {index: 1, routes: [{name: "SearchHome"}, {name: "UserProfile", params}]}}]}}] };
      }
      if (target?.kind === "story") return { routes: [{ name: "Main" }, { name: "StoryLink", params: { storyId: target.storyId } }] };
      if (target?.kind === "conversation") {
        return { routes: [{ name: "Main", state: { routes: [{ name: "DM", state: { routes: [{ name: "DMInbox" }, { name: "Conversation", params: { conversationId: target.conversationId } }] } }] } }] };
      }
      if (target?.kind === "activity") return { routes: [{ name: "Main" }, { name: "Activity" }] };
      if (target?.kind === "home") return { routes: [{ name: "Main", state: { routes: [{ name: "Home" }] } }] };
      if (target?.kind === "followRequests") return { routes: [{ name: "Main" }, { name: "FollowRequests" }] };
      if (target?.kind === "verification") return { routes: [{ name: "Main" }, { name: "Settings" }, { name: "Verification" }] };
      return undefined;
    },
  }), []);
  // Signed out, only password-reset links are meaningful.
  const signedOutLinking = useMemo<LinkingOptions<AuthStackParamList>>(() => ({
    prefixes: LINK_PREFIXES,
    getStateFromPath: path => {
      const target = deepLinkTarget(path);
      if (target?.kind !== "resetPassword") return undefined;
      const { kind: _kind, ...params } = target;
      return { routes: [{ name: "Login" }, { name: "ResetPassword", params }] };
    },
  }), []);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (status === "signedIn") {
    // Waits for the onboarding check, so Home doesn't flash before the first-run screens.
    if (user && !user.emailVerificationRequired && onboarding === null) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
    const inApp = !user?.emailVerificationRequired && !onboarding;
    return (
      <OnboardingProvider value={onboardingControl}>
        <NavigationContainer ref={navigationRef} key={user?.id ?? "signedIn"} linking={linking} theme={navigationTheme()} onStateChange={(state) => setCurrentScreen(focusedRouteName(state))}>
          <SignedInNavigator onboarding={!!onboarding && !user?.emailVerificationRequired} />
          {inApp ? <NearbyPrompt /> : null}
          {inApp ? (
            <InAppNotificationBanner
              currentRoute={() => (navigationRef.isReady() ? navigationRef.getCurrentRoute() : undefined)}
              open={(url) => openLink.current?.(url)}
            />
          ) : null}
          <UploadRunner />
        </NavigationContainer>
      </OnboardingProvider>
    );
  }
  return <NavigationContainer key="signedOut" linking={signedOutLinking} theme={navigationTheme()}><AuthNavigator /></NavigationContainer>;
}

/** Headers, screen backgrounds and borders in the app's light or dark colours. */
function navigationTheme(): Theme {
  const base = colorScheme() === "light" ? DefaultTheme : DarkTheme;
  return {
    ...base,
    dark: colorScheme() === "dark",
    colors: { ...base.colors, primary: colors.accent, background: colors.background, card: colors.background, text: colors.textPrimary, border: colors.border, notification: colors.accent },
  };
}
