import AuthShell from '@/components/auth/shell';

export default function PrivacyPage() {
  return (
    <AuthShell title="隐私政策" eyebrow="草稿 · 上线前需确认" wide>
      <div className="space-y-3 text-sm leading-relaxed text-ink/80">
        <p>【草稿占位】本页内容在正式上线前由站长确认后替换。要点：</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>收集项目：邮箱、密码（仅保存加密哈希）、站内昵称；选填的性别、出生年、日语学习历。</li>
          <li>用途：登录与找回密码、显示昵称、按学习历做匿名统计与排行榜分组。</li>
          <li>用户自录音频：公开展示于本站，可由本人在「我的账户」删除。</li>
          <li>保存期限：账号注销后邮箱与资料即被清除；日志最多保留 90 天。</li>
          <li>不向第三方出售数据；邮件发送使用第三方邮件服务，仅传递邮箱地址与邮件内容。</li>
          <li>删除或查询个人数据：通过站内「我的账户」或联系站长。</li>
        </ul>
      </div>
    </AuthShell>
  );
}
