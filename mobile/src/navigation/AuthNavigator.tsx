import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "./types";
import { LoginScreen } from "../screens/auth/LoginScreen";
import { SignupScreen } from "../screens/auth/SignupScreen";
import {AppealsScreen} from '../screens/profile/AppealsScreen';
import { ForgotPasswordScreen } from "../screens/auth/ForgotPasswordScreen";
import { ResetPasswordScreen } from "../screens/auth/ResetPasswordScreen";
import { colors } from "../theme";
import { PUSH_TRANSITION } from "./transitions";
import { useAuth } from "../state/AuthContext";

const header = { headerShown: true, title: "", headerTransparent: true, headerTintColor: colors.textPrimary } as const;

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator(): React.JSX.Element {
  // Sign-in errors are shared (useAuth): one screen's ("Incorrect password", a wrong reset code)
  // goes when you leave it, so it isn't shown on Sign up or back on Log in.
  const { clearError } = useAuth();
  return (
    <Stack.Navigator screenOptions={{ ...PUSH_TRANSITION, headerShown: false }} screenListeners={{ blur: clearError, beforeRemove: clearError }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="Appeals" component={AppealsScreen} options={{headerShown:true,title:'Account review'}}/>
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={header} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={header} />
    </Stack.Navigator>
  );
}
