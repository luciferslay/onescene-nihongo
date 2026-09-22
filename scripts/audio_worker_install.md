# 音频工作队列：安装说明（商务日语站）

项目根目录：`/Users/lunafan/Developer/nihongo/business-japanese/`。与韩语站的 worker（`com.haruhancut.audio-worker`）
是两个独立的 launchd 代理，各自只盯自己的 `audio-jobs/` 目录，可以同时装、互不影响。
（韩语站当年迁出“文稿”是因为 macOS 不让无交互的 LaunchAgent 读“文稿”目录；新项目直接建在 ~/Developer 下，没这个问题。）

## 一次性安装（Luna 在终端执行，四行）

```zsh
cp ~/Developer/nihongo/business-japanese/scripts/com.business-japanese.audio-worker.plist ~/Library/LaunchAgents/
chmod +x ~/Developer/nihongo/business-japanese/scripts/audio_worker.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.business-japanese.audio-worker.plist
launchctl kickstart -k gui/$(id -u)/com.business-japanese.audio-worker
```

装好后 Claude 会投一个 `smoke.job`（内容 `smoke_test_tts.py`）做冒烟测试；通过标准：`audio-jobs/smoke.log` 末尾有 `exit 0`、`smoke.done` 存在。

## 日常使用（Claude 负责）

Claude 往 `audio-jobs/` 放 `<名字>.job`（第一行：`scripts/` 下的脚本文件名；后面可以写 `lesson=biz-01`、`seed_offset=N`、`match_prosody=1`、`redo=a.wav,b.wav` 这类选项），
launchd 自动执行；日志 `<名字>.log`，成功改名 `.done`，失败改名 `.failed`。一次可以投多个 job，worker 按文件名顺序串行跑。

卸载：`launchctl bootout gui/$(id -u)/com.business-japanese.audio-worker && rm ~/Library/LaunchAgents/com.business-japanese.audio-worker.plist`

注意：Mac 合盖睡眠时不会生成；生成期间脚本用 caffeinate 防止空闲睡眠。
