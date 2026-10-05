import {AccountSecurityScreen} from "../screens/profile/AccountSecurityScreen";
import {UploadQueueScreen} from '../screens/create/UploadQueueScreen';
import {AppealsScreen} from '../screens/profile/AppealsScreen';
import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { NavigationContainer, type LinkingOptions } from "@react-navigation/native";
import { deepLinkTarget } from "./profileLinks";
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
import { BlockedAccountsScreen } from "../screens/profile/BlockedAccountsScreen";
import { MutedAccountsScreen } from "../screens/profile/MutedAccountsScreen";
import { FollowListScreen } from "../screens/profile/FollowListScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * StoryViewer lives at the root, above the tabs, so any screen (Profile,
 * Search results, later Home's story tray) can open it the same way,
 * regardless of which tab's stack it was tapped from.
 */
function SignedInNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="Main" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} options={{headerShown:true,title:"Account security",headerStyle:{backgroundColor:colors.background},headerTintColor:colors.textPrimary}}/>
      <Stack.Screen name="Main" component={MainTabs} />
      <Stack.Screen name="UploadQueue" component={UploadQueueScreen} options={{headerShown:true,title:'Story uploads',headerStyle:{backgroundColor:colors.background},headerTintColor:colors.textPrimary}}/>
      <Stack.Screen name="Appeals" component={AppealsScreen} options={{headerShown:true,title:'Account review',headerStyle:{backgroundColor:colors.background},headerTintColor:colors.textPrimary}}/>
      <Stack.Screen name="StoryViewer" component={StoryViewerScreen} options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="StoryLink" component={StoryLinkScreen} options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="HighlightViewer" component={HighlightViewerScreen} options={{ presentation: "fullScreenModal" }} />
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
        options={{ presentation: "fullScreenModal" }}
      />
      <Stack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{
          headerShown: true,
          title: "Edit Profile",
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
          title: "Follow Requests",
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
          title: "Blocked Accounts",
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
          title: "Muted Accounts",
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
  const pendingLink = useRef<string | null>(null);
  // A profile or Story link that arrives while signed out opens after sign-in.
  useEffect(() => {
    if (status === "signedIn") return;
    const subscription = Linking.addEventListener("url", ({url}) => {
      const target = url.startsWith("katkee://") ? deepLinkTarget(url.slice(9)) : null;
      if (target && target.kind !== "resetPassword") pendingLink.current = url;
    });
    return () => subscription.remove();
  }, [status]);
  const linking = useMemo<LinkingOptions<RootStackParamList>>(() => ({
    prefixes: ["katkee://"],
    getInitialURL: async () => {
      const url = pendingLink.current ?? await Linking.getInitialURL();
      pendingLink.current = null;
      return url;
    },
    getStateFromPath: path => {
      const target = deepLinkTarget(path);
      if (target?.kind === "profile") {
        return { routes: [{name: "Main", state: {routes: [{name: "Search", state: {routes: [{name: "UserProfile", params: {username: target.username}}]}}]}}] };
      }
      if (target?.kind === "story") return { routes: [{ name: "Main" }, { name: "StoryLink", params: { storyId: target.storyId } }] };
      return undefined;
    },
  }), []);
  // Signed out, only password-reset links are meaningful.
  const signedOutLinking = useMemo<LinkingOptions<AuthStackParamList>>(() => ({
    prefixes: ["katkee://"],
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
    return <NavigationContainer key={user?.id ?? "signedIn"} linking={linking}><SignedInNavigator /></NavigationContainer>;
  }
  return <NavigationContainer key="signedOut" linking={signedOutLinking}><AuthNavigator /></NavigationContainer>;
}
