# 网页里通过 window.FishApp 调用的方法，混淆时必须保留
-keepclassmembers class com.satloot.fish.MainActivity$JsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
