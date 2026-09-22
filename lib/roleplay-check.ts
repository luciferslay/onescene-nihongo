import type { Register, RoleplayLine, Scene } from './lessons/types';

/**
 * 角色扮演的规则判定（方案 A，Luna 2026-09-22 拍板；之后可能换成大模型判定的方案 C）。
 * 不拿课文原句当标准答案，只看：是不是完整的日语句、语体对不对、意思说到了没有、有没有踩本课的常见错法。
 * 已知局限：语音识别会把说错的话自动纠正成通顺日语，所以转写结果先给学习者看、允许手改，判定只对转写后的文字负责。
 */
export type RoleplayCheck = { label: string; pass: boolean; hint?: string };

const JA = /[\u3040-\u30ff\u4e00-\u9fff]/;
const ENDING =
  /(です|ます|でした|ました|ません|でしょう|ましょう|ください|ない|た|だ|る|う|く|す|つ|ぬ|ぶ|む|ぐ|ね|よ|か|わ|ぞ|ん|い)[。.!?！？]?$/;
/** 敬語（尊敬語・謙譲語）的标记：只有 です・ます 不算。 */
const KEIGO =
  /(いたし|ござい|申し|参り|伺|頂戴|いただ|くださ|お待たせ|恐れ入り|お[一-龥ぁ-ん]{1,4}(し|いた)(ます|まし)|ご[一-龥]{1,4}(し|いた)(ます|まし)|いらっしゃ|おっしゃ|なさ|ご覧|拝見|存じ)/;
const TEINEI = /(です|ます|でした|ました|ません|ましょう|でしょう)/;
const TAMEGUCHI = /(だよ|だね|じゃん|っす|ちゃった|とくね|てね|かな[。？?]?$|よね[。？?]?$)/;

function registerCheck(text: string, register: Register): RoleplayCheck {
  if (register === '敬語') {
    if (KEIGO.test(text)) return { label: '语体：敬語（尊敬語・謙譲語）', pass: true };
    if (TEINEI.test(text))
      return {
        label: '语体：敬語（尊敬語・謙譲語）',
        pass: false,
        hint: '只有です・ます。对客户要再上一档：申します／いたします／いただきます 这类说法。',
      };
    return { label: '语体：敬語（尊敬語・謙譲語）', pass: false, hint: '这句是普通体，对客户不能这样说。' };
  }
  if (register === '丁寧語') {
    return TEINEI.test(text)
      ? { label: '语体：丁寧語（です・ます）', pass: true }
      : { label: '语体：丁寧語（です・ます）', pass: false, hint: '句尾要用です・ます。' };
  }
  return !TEINEI.test(text) || TAMEGUCHI.test(text)
    ? { label: '语体：タメ口', pass: true }
    : { label: '语体：タメ口', pass: false, hint: '跟同期说话不用です・ます。' };
}

export function checkRoleplay(text: string, scene: Scene, line: RoleplayLine): RoleplayCheck[] {
  const t = text.trim();
  const checks: RoleplayCheck[] = [
    {
      label: '是完整的日语句',
      pass: JA.test(t) && !/[A-Za-z]/.test(t) && ENDING.test(t),
      hint: '要说成完整的一句，句尾收住。',
    },
    registerCheck(t, scene.register),
  ];
  for (const group of line.keywords) {
    const hit = group.some((k) => t.includes(k));
    checks.push({
      label: `意思：说到了「${group[0]}」`,
      pass: hit,
      hint: hit ? undefined : `这句话要把「${group[0]}」这层意思说出来（说法不限）。`,
    });
  }
  for (const m of scene.mistakes ?? []) {
    if (new RegExp(m.pattern).test(t)) checks.push({ label: '用法', pass: false, hint: m.hint });
  }
  return checks;
}
