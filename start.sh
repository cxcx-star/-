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
node -e "
const os=require('os');const rows=[];
for(const n of Object.keys(os.networkInterfaces())){
  for(const x of os.networkInterfaces()[n]||[]){
    if(x.family!=='IPv4'||x.internal)continue;
    let tag='';
    if(/^(ap|swlan|wlan1|softap|br-)/.test(n)) tag='  ← 热点';
    rows.push('  '+n.padEnd(10)+' http://'+x.address+':8787/'+tag);
  }
}
if(!rows.length) console.log('  未检测到网卡地址，请确认已连 Wi-Fi 或开着热点');
else console.log(rows.join('\n'));
"
echo "  本机（这台手机上）http://127.0.0.1:8787/"
echo "  ──────────────────────────────────────────────"
echo "  停止：./start.sh stop      日志：server.log"
echo
