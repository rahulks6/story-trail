package com.katkee

import com.android.installreferrer.api.InstallReferrerClient
import com.android.installreferrer.api.InstallReferrerStateListener
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The install referrer Google Play keeps for the app: the `referrer` of the Play Store link it was
 * installed from. The invite page's Google Play button carries `katkee_invite=<code>`, so a friend
 * who installs from it is credited without tapping the invite link again (state/installReferrer.ts).
 * Google Play's own library; nothing else is read, and nothing leaves the phone from here.
 */
class InstallReferrerModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeInstallReferrer"

  /** The referrer text, or null when there is none or Play can't answer (no Play Store, an old one). */
  @ReactMethod
  fun getReferrer(promise: Promise) {
    val settled = AtomicBoolean(false)
    fun settle(value: String?) { if (settled.compareAndSet(false, true)) promise.resolve(value) }
    val client = try { InstallReferrerClient.newBuilder(reactApplicationContext).build() } catch (e: Exception) { return settle(null) }
    try {
      client.startConnection(object : InstallReferrerStateListener {
        override fun onInstallReferrerSetupFinished(responseCode: Int) {
          try {
            settle(if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) client.installReferrer.installReferrer else null)
          } catch (e: Exception) {
            settle(null)
          } finally {
            try { client.endConnection() } catch (e: Exception) { }
          }
        }
        override fun onInstallReferrerServiceDisconnected() = settle(null)
      })
    } catch (e: Exception) {
      settle(null)
    }
  }
}

class InstallReferrerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(InstallReferrerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
