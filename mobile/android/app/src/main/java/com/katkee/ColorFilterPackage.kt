package com.katkee

import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.uimanager.UIManagerHelper

/**
 * A Story filter on a playing video in the editor, exactly as the server will apply it: the
 * view (a plain View around the video, drawn on a TextureView) is drawn into a hardware layer
 * whose paint has the filter's colour matrix (utils/videoFilter.ts), on every Android version.
 * A null matrix takes it off. Resolves whether the filter is now showing.
 */
class ColorFilterModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "KatkeeColorFilter"

  @ReactMethod
  fun setColorMatrix(tag: Double, matrix: ReadableArray?, promise: Promise) {
    UiThreadUtil.runOnUiThread {
      try {
        val id = tag.toInt()
        val view: View? = UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, id)?.resolveView(id)
        if (view == null) {
          promise.resolve(false)
          return@runOnUiThread
        }
        if (matrix == null || matrix.size() != 20) {
          view.setLayerType(View.LAYER_TYPE_NONE, null)
          promise.resolve(matrix == null)
          return@runOnUiThread
        }
        val values = FloatArray(20) { matrix.getDouble(it).toFloat() }
        val paint = Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix(values)) }
        view.setLayerType(View.LAYER_TYPE_HARDWARE, paint)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }
  }
}

class ColorFilterPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ColorFilterModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
