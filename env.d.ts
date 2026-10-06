/// <reference types="@cloudflare/workers-types" />
// 站点在 Cloudflare Workers 运行时可用的绑定与变量。
// 本地 dev 由 vite.config.ts 的 localBindingConfig 提供（D1 走 miniflare，数据在 .wrangler/state）。
// 密钥放 .dev.vars（不入库）；线上在托管平台的「环境变量 / 密钥」里配置。
declare namespace Cloudflare {
  interface Env {
    /** D1 数据库（会员、邀请码、用户录音……） */
    DB: D1Database;
    /** Resend 的 API key；没有它就进入演示模式：邮件写进 outbox 表，在 /outbox 页面看 */
    RESEND_API_KEY?: string;
    /** 发件地址，例如 "ワンシーンで学ぶ日本語 <noreply@example.com>" */
    /** 演示模式下，线上查看 /outbox 要带的 ?key=（本机与局域网不需要） */
    OUTBOX_KEY?: string;
    MAIL_FROM?: string;
    /** 逗号分隔的管理员邮箱；这些邮箱注册/登录时自动获得 admin 角色 */
    ADMIN_EMAILS?: string;
    /** 站点对外地址（用于拼邮件里的链接），不填就用请求的 origin */
    APP_ORIGIN?: string;
    /** 给会话 cookie / 令牌加盐的密钥；线上务必设置成随机长字符串 */
    AUTH_SECRET?: string;
  }
}

// Vite 的 ?raw 导入（把 SQL 文件当字符串读进来）
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
