import AuthShell from '@/components/auth/shell';

export default function TermsPage() {
  return (
    <AuthShell title="利用规约" eyebrow="草稿 · 上线前需确认" wide>
      <div className="space-y-3 text-sm leading-relaxed text-ink/80">
        <p>【草稿占位】本页内容在正式上线前由站长确认后替换。要点：</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>本站提供日语学习内容；每课的第 1 步（场景任务与对话音频）免费，其余内容凭邀请码解锁。</li>
          <li>账号仅限本人使用，不得分享账号或邀请码。</li>
          <li>用户上传的朗读音频将公开展示；上传即视为同意公开，站长可在审核后拒绝或下架不当内容。</li>
          <li>禁止上传违法、侵权、骚扰或与课程无关的内容。</li>
          <li>付费与退款政策见「特定商取引法に基づく表記」。</li>
        </ol>
      </div>
    </AuthShell>
  );
}
