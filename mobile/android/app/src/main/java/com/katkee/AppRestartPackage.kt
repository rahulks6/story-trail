package com.katkee

import com.facebook.react.ReactApplication
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager

/**
 * Reloads the app's JavaScript so a new appearance (light or dark) applies to every screen at
 * once: the colours are chosen at launch, before any screen's styles exist (theme/appearance.ts).
 */
class AppRestartModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeAppRestart"

  @ReactMethod
  fun restart() {
    UiThreadUtil.runOnUiThread {
      (reactApplicationContext.applicationContext as? ReactApplication)?.reactHost?.reload("Appearance changed")
    }
  }
}

class AppRestartPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AppRestartModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
