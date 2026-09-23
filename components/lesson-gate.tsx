import LessonPage from '@/components/lesson-page';
import { currentAccess } from '@/lib/server/access';

/**
 * 课程门禁（服务端）：查出当前用户的权限，交给课程页。
 * 1/6 听对话人人可用；没解锁的用户在 1/6 结束处看到解锁面板，进不了 2/6 之后。
 */
export default async function LessonGate({ lessonId }: { lessonId: string }) {
  const access = await currentAccess();
  return (
    <LessonPage
      lessonId={lessonId}
      locked={!access.full}
      loggedIn={!!access.user}
      preview={access.preview}
    />
  );
}
