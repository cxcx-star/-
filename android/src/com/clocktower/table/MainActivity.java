package com.clocktower.table;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

/** 血染钟楼 · 城镇广场 —— 外壳：全屏 WebView，记住服务器地址，忽略自签名证书。 */
public class MainActivity extends Activity {

    private static final String PREFS = "ct";
    private static final String KEY_URL = "url";
    private static final String DEF_URL = "http://127.0.0.1:8787/";

    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0a090d"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedSslError(WebView v, SslErrorHandler handler, SslError err) {
                handler.proceed(); // 自签名证书，局域网自用
            }

            @Override
            public void onReceivedError(WebView v, int code, String desc, String failingUrl) {
                if (failingUrl != null && failingUrl.contains("/offline")) return;
                v.post(new Runnable() {
                    public void run() {
                        v.loadUrl("about:blank");
                        Toast.makeText(MainActivity.this,
                                "连不上服务器，检查手机端是否开着、地址是否变了（长按返回键可改地址）",
                                Toast.LENGTH_LONG).show();
                    }
                });
            }
        });

        String url = prefs.getString(KEY_URL, null);
        if (url == null) {
            askUrl(true);
        } else {
            web.loadUrl(url);
        }
    }

    private void askUrl(final boolean firstRun) {
        final EditText et = new EditText(this);
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        et.setText(prefs.getString(KEY_URL, DEF_URL));
        et.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
                .setTitle("服务器地址")
                .setMessage("手机（开服那台）首页上显示的地址，例如 http://192.168.1.25:8787/ （平板填手机首页显示的局域网地址）")
                .setView(et)
                .setCancelable(!firstRun)
                .setPositiveButton("连接", new android.content.DialogInterface.OnClickListener() {
                    public void onClick(android.content.DialogInterface d, int w) {
                        String u = et.getText().toString().trim();
                        if (u.isEmpty()) u = DEF_URL;
                        if (!u.startsWith("http")) u = "https://" + u;
                        if (!u.endsWith("/")) u = u + "/";
                        prefs.edit().putString(KEY_URL, u).apply();
                        web.loadUrl(u);
                    }
                })
                .show();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        askUrl(false);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
