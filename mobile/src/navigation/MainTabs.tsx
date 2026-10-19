import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "./types";
import { BottomTabBar } from "./BottomTabBar";
import { HomeScreen } from "../screens/home/HomeScreen";
import { SearchStack } from "./SearchStack";
import { CreateStack } from "./CreateStack";
import { DMStack } from "./DMStack";
import { ProfileScreen } from "../screens/profile/ProfileScreen";

const Tab = createBottomTabNavigator<MainTabParamList>();

/** HOME | SEARCH | + | DM | PROFILE: five tabs. Activity opens from the heart at the top of Home. */
export function MainTabs(): React.JSX.Element {
  return (
    <Tab.Navigator
      // Hidden tabs don't re-render on every context change (Home's Story feed pauses on blur first).
      screenOptions={{ headerShown: false, freezeOnBlur: true }}
      tabBar={(props) => <BottomTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchStack} />
      <Tab.Screen name="Create" component={CreateStack} />
      <Tab.Screen name="DM" component={DMStack} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
