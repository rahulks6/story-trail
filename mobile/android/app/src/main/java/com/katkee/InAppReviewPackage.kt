package com.katkee

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * Google Play's in-app review: the "Rate Katkee" card over the app, without leaving it
 * (state/reviewPrompt.ts decides when). Google decides whether the card actually shows (it limits
 * how often, and never shows one to someone who already reviewed), and never says whether the
 * person rated or what they gave, so this only reports that the flow finished.
 */
class InAppReviewModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeInAppReview"

  @ReactMethod
  fun requestReview(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    UiThreadUtil.runOnUiThread {
      try {
        val manager = ReviewManagerFactory.create(reactApplicationContext)
        manager.requestReviewFlow().addOnCompleteListener { request ->
          if (!request.isSuccessful) {
            promise.resolve(false)
            return@addOnCompleteListener
          }
          manager.launchReviewFlow(activity, request.result).addOnCompleteListener { promise.resolve(true) }
        }
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }
  }
}

class InAppReviewPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(InAppReviewModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
