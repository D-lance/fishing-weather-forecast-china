package com.satloot.fish;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.Locale;

/**
 * 今日鱼情 App 唯一的界面：一个全屏 WebView。
 *
 * 页面文件打包在 APK 的 assets/site/ 里（构建时从仓库根目录 site/ 拷入），
 * 通过 WebViewAssetLoader 以 https://appassets.androidplatform.net/ 这个“虚拟网址”加载：
 *   - 是 https 安全来源，网页里的定位、剪贴板、ES 模块都能正常用；
 *   - 没网也能打开界面（天气、地图、地名仍需联网，由网页直接请求各数据源）。
 */
public class MainActivity extends Activity {

    /** WebViewAssetLoader 的默认虚拟域名 */
    static final String APP_HOST = WebViewAssetLoader.DEFAULT_DOMAIN; // appassets.androidplatform.net
    static final String APP_ORIGIN = "https://" + APP_HOST;
    /** 线上网站，分享链接用它，外面点进来的这个域名链接也在 App 里打开 */
    static final String SITE_HOST = "fish.satloot.com";

    private static final int REQ_LOCATION = 1001;
    private static final String PREFS = "fishcast";
    private static final String PREF_LANG = "lang"; // 用户在页面上手动切换过的语言：zh / en

    private WebView webView;
    private WebViewAssetLoader assetLoader;

    // 网页请求定位时，如果还没拿到系统定位权限，先记下来，等用户在系统弹窗里选完再回复网页
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.page_bg));
        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.page_bg));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        applyEdgeToEdgeInsets(root);

        // 虚拟网址根路径 / 对应 assets/site/，目录自动补 index.html
        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(APP_HOST)
                .addPathHandler("/", new SitePathHandler(getAssets()))
                .build();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 网页用 localStorage 记最近查过的水域、底图、语言
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);           // 页面都走虚拟网址，不需要 file://
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);    // target=_blank 也走同一个 WebView，再由下面统一分流
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF); // 只用浅色
        }

        webView.addJavascriptInterface(new JsBridge(), "FishApp");
        webView.setWebViewClient(new ShellClient());
        webView.setWebChromeClient(new ShellChrome());

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            return;
        }
        webView.loadUrl(startUrl(getIntent()));
    }

    // ───────── 启动地址：外部链接 > 用户上次手选的语言 > 系统语言 ─────────

    private String startUrl(Intent intent) {
        String fromLink = mapSiteLink(intent == null ? null : intent.getData());
        if (fromLink != null) return fromLink;
        String lang = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_LANG, null);
        if (lang == null) {
            lang = Locale.getDefault().getLanguage().toLowerCase(Locale.ROOT).startsWith("zh") ? "zh" : "en";
        }
        return APP_ORIGIN + ("en".equals(lang) ? "/en/" : "/");
    }

    /** 把 https://fish.satloot.com/xxx?lat=..&lon=.. 换成 App 内的同路径地址；不是本站链接返回 null */
    static String mapSiteLink(Uri u) {
        if (u == null || !"https".equals(u.getScheme()) && !"http".equals(u.getScheme())) return null;
        if (!SITE_HOST.equalsIgnoreCase(u.getHost())) return null;
        String path = u.getEncodedPath();
        if (path == null || path.isEmpty()) path = "/";
        StringBuilder sb = new StringBuilder(APP_ORIGIN).append(path);
        if (u.getEncodedQuery() != null) sb.append('?').append(u.getEncodedQuery());
        if (u.getEncodedFragment() != null) sb.append('#').append(u.getEncodedFragment());
        return sb.toString();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String url = mapSiteLink(intent.getData());
        if (url != null) webView.loadUrl(url);
    }

    // ───────── 返回键：先退网页历史，退到头再关 App ─────────

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ───────── Android 15 起强制全面屏：手动给状态栏/导航栏/键盘让出位置 ─────────

    private void applyEdgeToEdgeInsets(View root) {
        if (Build.VERSION.SDK_INT < 35) return; // 老系统由主题里的浅色状态栏处理
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    // ───────── 定位权限：网页要定位 → 先要系统权限 → 再回复网页 ─────────

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_LOCATION || pendingGeoCallback == null) return;
        boolean granted = false;
        for (int r : grantResults) granted |= r == PackageManager.PERMISSION_GRANTED;
        pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
        pendingGeoCallback = null;
        pendingGeoOrigin = null;
    }

    private class ShellChrome extends WebChromeClient {
        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            // 只给 App 自己的页面定位
            if (origin == null || !origin.startsWith(APP_ORIGIN)) {
                callback.invoke(origin, false, false);
                return;
            }
            if (hasLocationPermission()) {
                callback.invoke(origin, true, false);
                return;
            }
            if (pendingGeoCallback != null) pendingGeoCallback.invoke(pendingGeoOrigin, false, false);
            pendingGeoOrigin = origin;
            pendingGeoCallback = callback;
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
        }

        @Override
        public void onGeolocationPermissionsHidePrompt() {
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    // ───────── 链接分流：本站在 App 里开，其他网址交给系统浏览器 ─────────

    private class ShellClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (APP_HOST.equalsIgnoreCase(u.getHost())) {
                // 用户点了页面上的语言切换，就记住，下次启动直接进这个语言
                if (request.isForMainFrame() && request.hasGesture()) rememberLang(u.getPath());
                return false;
            }
            String inApp = mapSiteLink(u);
            if (inApp != null) {
                view.loadUrl(inApp);
                return true;
            }
            openExternal(u);
            return true;
        }
    }

    private void rememberLang(String path) {
        String lang = path != null && (path.equals("/en") || path.startsWith("/en/")) ? "en" : "zh";
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(PREF_LANG, lang).apply();
    }

    private void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
    }

    // ───────── 给网页用的小接口：window.FishApp ─────────

    /** 网页里「复制分享链接」在 App 中改为调起系统分享面板（链接是线上网址，别人没装 App 也能打开） */
    class JsBridge {
        @JavascriptInterface
        public void share(String url, String title) {
            if (url == null || !url.startsWith("https://" + SITE_HOST + "/")) return;
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, title == null || title.isEmpty() ? url : title + "\n" + url);
                try {
                    startActivity(Intent.createChooser(send, getString(R.string.share_title)));
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }
    }

    // ───────── 本地页面文件：/xxx → assets/site/xxx ─────────

    /** 与 WebViewAssetLoader.AssetsPathHandler 类似，但目录自动补 index.html，并按扩展名给正确的类型（ES 模块要求 JS 类型正确） */
    static class SitePathHandler implements WebViewAssetLoader.PathHandler {
        private final AssetManager assets;

        SitePathHandler(AssetManager assets) {
            this.assets = assets;
        }

        @Override
        public WebResourceResponse handle(String path) {
            if (path.contains("..")) return notFound();
            if (path.isEmpty() || path.endsWith("/")) path = path + "index.html";
            else if (path.equals("en")) path = "en/index.html";
            try {
                InputStream in = assets.open("site/" + path, AssetManager.ACCESS_STREAMING);
                String mime = mimeOf(path);
                String enc = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript") ? "utf-8" : null;
                WebResourceResponse r = new WebResourceResponse(mime, enc, in);
                r.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-cache"));
                return r;
            } catch (IOException e) {
                return notFound();
            }
        }

        private static WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    Collections.<String, String>emptyMap(), null);
        }

        static String mimeOf(String path) {
            String p = path.toLowerCase(Locale.ROOT);
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".json")) return "application/json";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
            if (p.endsWith(".svg")) return "image/svg+xml";
            if (p.endsWith(".webp")) return "image/webp";
            if (p.endsWith(".ico")) return "image/x-icon";
            if (p.endsWith(".xml")) return "application/xml";
            if (p.endsWith(".txt")) return "text/plain";
            if (p.endsWith(".woff2")) return "font/woff2";
            return "application/octet-stream";
        }
    }
}
