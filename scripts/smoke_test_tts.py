# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "pykakasi"]
# ///
"""音频队列冒烟测试：用 A/B 两套标准预设各生成一条短句到 audio-jobs/smoke/，不触碰课程音频。"""
from standardized_course_tts import ROOT, generate, load_config, voice_for_role

OUT = ROOT / "audio-jobs" / "smoke"
OUT.mkdir(parents=True, exist_ok=True)
TEXT = "本日はお忙しいところ、お時間をいただきありがとうございます。"
cfg = load_config()
for voice, name in ((voice_for_role(cfg, "A"), "smoke-a.wav"), (voice_for_role(cfg, "B"), "smoke-b.wav")):
    manifest = generate(voice, TEXT, OUT / name)
    status = "pass" if manifest["quality_assessment"]["automatic_pass"] else "check"
    print(name, status, manifest["metrics"]["duration_seconds"], "s")
