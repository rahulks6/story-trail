import React from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { ContactsFinder } from "../../components/ContactsFinder";

type Props = NativeStackScreenProps<RootStackParamList, "ContactsOnKatkee">;

/** Settings > Contacts on Katkee, and "Find friends from your contacts" in Search. */
export function ContactsScreen({ navigation, route }: Props): React.JSX.Element {
  return (
    <ContactsFinder
      source={route.params?.from ?? "settings"}
      onOpenProfile={(username) => navigation.navigate("Main", { screen: "Search", params: { screen: "UserProfile", initial: false, params: { username } } })}
    />
  );
}
