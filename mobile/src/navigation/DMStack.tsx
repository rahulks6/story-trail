import { Icon } from "../components/Icon";
import React from "react";
import { Text } from "react-native";
import { Pressable } from "../components/Pressable";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { DMStackParamList } from "./types";
import { colors, spacing, ICONS } from "../theme";
import { DMInboxScreen } from "../screens/dm/DMInboxScreen";
import { ConversationScreen } from "../screens/dm/ConversationScreen";
import { NewGroupScreen } from "../screens/dm/NewGroupScreen";
import { GroupInfoScreen } from "../screens/dm/GroupInfoScreen";
import { NewChatScreen } from "../screens/dm/NewChatScreen";
import { PUSH_TRANSITION } from "./transitions";
import { t } from "../i18n";

const Stack = createNativeStackNavigator<DMStackParamList>();

export function DMStack(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        ...PUSH_TRANSITION,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="DMInbox"
        component={DMInboxScreen}
        options={({ navigation }) => ({
          title: t("common.messages"),
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate("NewChat")}
              hitSlop={8}
              style={{ paddingHorizontal: spacing.xs }}
              accessibilityRole="button"
              accessibilityLabel={t("dMStack.newChat")}
            >
              <Icon style={{ color: colors.textPrimary, fontSize: 20 }} name={ICONS.newChat} />
            </Pressable>
          ),
        })}
      />
      <Stack.Screen name="Conversation" component={ConversationScreen} options={{ title: "" }} />
      <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: t("common.newMessage") }} />
      <Stack.Screen name="NewGroup" component={NewGroupScreen} options={{ title: t("common.newGroup") }} />
      <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ title: t("common.group") }} />
    </Stack.Navigator>
  );
}
