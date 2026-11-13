#!/bin/sh
# 启动局域网版（手机当服务器，平板/其他设备用浏览器打开）
# 用法：./start.sh        停止：./start.sh stop
cd "$(dirname "$0")" || exit 1

stop_it() {
  for p in /proc/[0-9]*; do
    [ -r "$p/cmdline" ] || continue
    if tr '\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q "node server.js"; then
      kill "${p#/proc/}" 2>/dev/null && echo "已停止 PID ${p#/proc/}"
    fi
  done
}

if [ "$1" = "stop" ]; then
  stop_it
  exit 0
fi

stop_it
nohup node server.js > server.log 2>&1 &
sleep 2

echo
echo "  局域网版已启动"
echo "  ──────────────────────────────────────────────"
LOCAL_IP=$(node -e "const os=require('os');const o=[];for(const n of Object.keys(os.networkInterfaces()))for(const x of os.networkInterfaces()[n]||[])if(x.family==='IPv4'&&!x.internal)o.push(x.address);console.log(o[0]||'')")
echo "  手机（本机）    http://127.0.0.1:8787/"
[ -n "$LOCAL_IP" ] && echo "  平板（同 Wi-Fi） http://$LOCAL_IP:8787/"
[ -n "$LOCAL_IP" ] && echo "                https://$LOCAL_IP:8443/   （浏览器拦 http 时用这个）"
echo "  ──────────────────────────────────────────────"
echo "  停止：./start.sh stop      日志：server.log"
echo
