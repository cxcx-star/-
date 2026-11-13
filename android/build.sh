#!/bin/sh
# 血染钟楼 · 外壳 APK 构建脚本（无 Android SDK / 无 Gradle，纯 aapt + d8 + apksigner）
set -e
cd "$(dirname "$0")"

ANDK=${ANDK:-/tmp/andk}
JDK="$ANDK/jdk"
AJAR="$ANDK/android-9/android.jar"
LIBS="$ANDK/debs/root/usr/lib/aarch64-linux-gnu/android:$ANDK/debs/root/usr/lib/aarch64-linux-gnu:$ANDK/debs/root/usr/lib:$ANDK/debs/root/usr/lib/7zip"
run_ld() { /lib/ld-linux-aarch64.so.1 --library-path "$LIBS" "$@"; }
AAPT="$ANDK/debs/root/usr/bin/aapt"
ZIPALIGN="$ANDK/debs/root/usr/bin/zipalign"
APKSIGNER="$ANDK/debs/root/usr/share/java/apksigner.jar"

OUT=dist
B=build
rm -rf "$B"; mkdir -p "$B/classes" "$B/dex" "$OUT"

echo "[1/6] aapt 打包资源"
run_ld "$AAPT" package -f -M AndroidManifest.xml -S res -I "$AJAR" -F "$B/app-unsigned.apk"

echo "[2/6] javac 编译"
"$JDK/bin/javac" -nowarn -source 8 -target 8 -encoding UTF-8 -bootclasspath "$AJAR" -d "$B/classes" $(find src -name '*.java') 2>&1 | grep -v 'bootstrap class path' || true

echo "[3/6] d8 生成 classes.dex"
"$JDK/bin/java" -cp "$ANDK/r8.jar" com.android.tools.r8.D8 \
  --release --min-api 23 --lib "$AJAR" --output "$B/dex" $(find "$B/classes" -name '*.class')

echo "[4/6] 打进 APK"
(cd "$B/dex" && zip -q "$OLDPWD/$B/app-unsigned.apk" classes.dex)

echo "[5/6] 对齐"
run_ld "$ZIPALIGN" -f 4 "$B/app-unsigned.apk" "$B/app-aligned.apk"

echo "[6/6] 签名"
if [ ! -f keystore.jks ]; then
  "$JDK/bin/keytool" -genkeypair -keystore keystore.jks -storepass clocktower -keypass clocktower \
    -alias ct -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Clocktower Table, O=Local, C=CN" >/dev/null 2>&1
fi
"$JDK/bin/java" -jar "$APKSIGNER" sign --ks keystore.jks --ks-pass pass:clocktower \
  --key-pass pass:clocktower --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT/clocktower-1.0.apk" "$B/app-aligned.apk"

"$JDK/bin/java" -jar "$APKSIGNER" verify --print-certs "$OUT/clocktower-1.0.apk" | head -4
ls -la "$OUT/clocktower-1.0.apk"
