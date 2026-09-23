#!/bin/zsh
# 商务日语站 音频生成工作队列（在 Mac 本机运行；与韩语站的 worker 各管各的目录，互不影响）
#
# 用途：让 Claude 不用打开终端也能在这台 Mac 上生成课程音频。
# 机制：Claude 往 business-japanese/audio-jobs/ 放一个 *.job 文件（内容是要运行的脚本名，
#       例如 generate_lesson_audio.py）；本脚本发现后用 uv 运行它，日志写到同名 .log，
#       成功后把 .job 改名为 .done，失败改名为 .failed。生成脚本本身支持断点续作，
#       所以中断后重新投递同一个 job 即可继续。
# 安装（一次性）：见 scripts/audio_worker_install.md。
# 运行期间用 caffeinate 防止 Mac 因空闲进入睡眠（合盖仍会睡眠）。

set -u
PROJECT_DIR="${0:A:h:h}"
JOBS_DIR="$PROJECT_DIR/audio-jobs"
mkdir -p "$JOBS_DIR"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# 两个站（韩语 hangugeo、日语 nihongo）的 worker 共用一把锁：同一时间只跑一个重任务。
# 起因（2026-09-23）：两边同时各载一个 1.7B 模型 + whisper，Mac 内存不够开始换页，两边都慢到一条音频 20 分钟。
# 预览、路由检查这类轻任务不排队。
LOCK="$HOME/Developer/.audio-worker.lock"
acquire_lock() {
  while ! mkdir "$LOCK" 2>/dev/null; do
    local holder
    holder="$(cat "$LOCK/pid" 2>/dev/null)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$LOCK"; continue
    fi
    sleep 20
  done
  echo $$ > "$LOCK/pid"
}
release_lock() { rm -rf "$LOCK"; }

run_job() {
  local job="$1"
  local name="${job:t:r}"
  local script
  script="$(head -n 1 "$job" | tr -d '[:space:]')"
  local log="$JOBS_DIR/$name.log"
  # 只有真正吃内存的 TTS / ASR 任务才排队；检查、发布、打散答案这类小脚本不排队。
  local heavy=0
  case "$script" in
    generate_*|fix_*|reconform*|audit_*|voice_samples*|smoke_test*|regenerate_*) heavy=1 ;;
  esac
  if (( heavy )); then
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') 等待共用音频锁（另一个站的 worker 可能正在跑）" >>"$log"
    acquire_lock
  fi
  {
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') start: $script"
    if [[ ! -f "$PROJECT_DIR/scripts/$script" ]]; then
      echo "script not found: scripts/$script"
      false
    else
      cd "$PROJECT_DIR" && caffeinate -i uv run --script "scripts/$script"
    fi
  } >>"$log" 2>&1
  local exit_status=$?
  (( heavy )) && release_lock
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') exit $exit_status" >>"$log"
  if [[ $exit_status -eq 0 ]]; then
    mv "$job" "$JOBS_DIR/$name.done"
  else
    mv "$job" "$JOBS_DIR/$name.failed"
  fi
}

# 一次处理所有待办 job（按文件名顺序），然后退出；launchd 会在目录变化时再次唤醒本脚本。
for job in "$JOBS_DIR"/*.job(N); do
  # 正在运行的 job 用 .running 标记，避免 launchd 重复触发时并发生成
  [[ -f "$JOBS_DIR/${job:t:r}.running" ]] && continue
  touch "$JOBS_DIR/${job:t:r}.running"
  run_job "$job"
  rm -f "$JOBS_DIR/${job:t:r}.running"
done
