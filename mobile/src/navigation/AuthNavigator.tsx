import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "./types";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { SignupScreen } from "../screens/auth/SignupScreen";
import {AppealsScreen} from '../screens/profile/AppealsScreen';
import { ForgotPasswordScreen } from "../screens/auth/ForgotPasswordScreen";
import { ResetPasswordScreen } from "../screens/auth/ResetPasswordScreen";
import { colors } from "../theme";

const header = { headerShown: true, title: "", headerTransparent: true, headerTintColor: colors.textPrimary } as const;

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="Appeals" component={AppealsScreen} options={{headerShown:true,title:'Account review'}}/>
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={header} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={header} />
    </Stack.Navigator>
  );
}
