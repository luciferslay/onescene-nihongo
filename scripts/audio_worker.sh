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

run_job() {
  local job="$1"
  local name="${job:t:r}"
  local script
  script="$(head -n 1 "$job" | tr -d '[:space:]')"
  local log="$JOBS_DIR/$name.log"
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
