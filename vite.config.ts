import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

/**
 * 绑定配置。
 * - 本地 dev：D1 用占位 id，由 miniflare 在 .wrangler/state 里模拟；变量读 .dev.vars（Cloudflare 插件自带）。
 * - 线上构建（Cloudflare Workers Builds，Cloudflare Workers）：
 *   只有在构建变量 D1_DATABASE_ID 填了真实数据库 id 时才绑定 D1。没填就不绑定 ——
 *   会员功能自动关闭（lib/server/access.ts），网站照旧全部开放，不会因为缺数据库而整站报错。
 */
function bindingConfig(isDev: boolean) {
  const prodDbId = process.env.D1_DATABASE_ID?.trim();
  const dbId = isDev ? SITE_CREATOR_PLACEHOLDER_DATABASE_ID : prodDbId;
  return {
    main: 'vinext/server/fetch-handler',
    compatibility_flags: ['nodejs_compat'],
    d1_databases:
      d1 && dbId
        ? [
            {
              binding: d1,
              database_name: isDev ? 'site-creator-d1' : 'japanese-learning-db',
              database_id: dbId,
            },
          ]
        : [],
    r2_buckets: r2
      ? [
          {
            binding: r2,
            bucket_name: 'site-creator-r2',
          },
        ]
      : [],
  };
}

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    // host: '0.0.0.0' 让本地预览同时监听局域网地址，Luna 的手机在同一个 Wi-Fi 下
    // 就能用 http://<Mac 的局域网 IP>:3100 直接看，不必每次都推到线上。
    // 端口 3100：韩语站的本地预览占着 3000，几个站要能同时开。
    server: {
      host: '0.0.0.0',
      port: 3100,
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: bindingConfig(command === 'serve'),
      }),
    ],
  };
});
