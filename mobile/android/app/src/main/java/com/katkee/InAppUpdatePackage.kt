package com.katkee

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

/**
 * Google Play's in-app update: when Play has a newer Katkee than the one on this phone, Play's own
 * full-screen "Update available" page shows over the app, and the update installs without going
 * to the Play Store (state/appUpdate.ts decides when to ask). The person can still close it with
 * Back. Resolves "shown", "none" (no newer version, or Play can't update here) or "error".
 */
class InAppUpdateModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeInAppUpdate"

  @ReactMethod
  fun checkAndUpdate(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve("none")
      return
    }
    UiThreadUtil.runOnUiThread {
      try {
        val manager = AppUpdateManagerFactory.create(reactApplicationContext)
        manager.appUpdateInfo.addOnCompleteListener { task ->
          if (!task.isSuccessful) {
            promise.resolve("error")
            return@addOnCompleteListener
          }
          val info = task.result
          val ready = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE ||
            // An update the person started earlier and left: carry on with it.
            info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
          if (!ready || !info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
            promise.resolve("none")
            return@addOnCompleteListener
          }
          manager.startUpdateFlow(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.IMMEDIATE))
          promise.resolve("shown")
        }
      } catch (e: Exception) {
        promise.resolve("error")
      }
    }
  }
}

class InAppUpdatePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(InAppUpdateModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
