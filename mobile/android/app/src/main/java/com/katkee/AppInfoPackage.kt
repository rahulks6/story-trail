package com.katkee

import android.os.Build
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.uimanager.ViewManager

/**
 * The build number (versionCode, e.g. 82) for config/env.ts: every release is "1.0.0", so without
 * it About, feedback and the analytics can't tell one release from the next.
 */
class AppInfoModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeAppInfo"
  override fun getConstants(): Map<String, Any> {
    val code = try {
      val info = reactApplicationContext.packageManager.getPackageInfo(reactApplicationContext.packageName, 0)
      if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else @Suppress("DEPRECATION") info.versionCode
    } catch (e: Exception) {
      0
    }
    return mapOf("buildNumber" to code)
  }
}

class AppInfoPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(AppInfoModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
