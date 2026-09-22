import { currentUserFromRequest, validNickname, GENDERS, STUDY_YEARS } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/account', { m: 'bad_request' });
  const user = await currentUserFromRequest(req);
  if (!user) return redirect(req, '/login', { m: 'need_login', next: '/account' });
  const f = await readForm(req);
  if (!validNickname(f.nickname ?? '')) return redirect(req, '/account', { m: 'bad_nickname' });
  const gender = GENDERS.some((g) => g.key === f.gender) ? f.gender : null;
  const birthYear = /^\d{4}$/.test(f.birth_year ?? '') ? Number(f.birth_year) : null;
  const studyYears = STUDY_YEARS.some((s) => s.key === f.study_years) ? f.study_years : null;
  const db = await getDb();
  await db
    .prepare('UPDATE users SET nickname = ?, gender = ?, birth_year = ?, study_years = ? WHERE id = ?')
    .bind(f.nickname.trim(), gender, birthYear, studyYears, user.id)
    .run();
  return redirect(req, '/account', { m: 'saved' });
}
