// Edge Function: send-notifications
// Supabase cron에서 00:00, 06:00, 12:00 KST에 호출됨
// 내일 예정된 수행 평가를 찾아 모든 구독된 기기에 Web Push 알림 전송

import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE')!;
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SERVICE_ROLE_KEY')!;

webpush.setVapidDetails(
  'mailto:25-10711@hyehwa-h.sen.hs.kr',
  VAPID_PUBLIC,
  VAPID_PRIVATE,
);

const headers = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
};

Deno.serve(async (_req) => {
  // 한국 표준시(KST = UTC+9) 기준 내일 날짜 계산
  const nowUtcMs = Date.now();
  const kstMs    = nowUtcMs + 9 * 60 * 60 * 1000;
  const kstNow   = new Date(kstMs);
  const kstHour  = kstNow.getUTCHours();

  const tomorrow = new Date(kstMs);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // 시간대별 알림 메시지
  let timeLabel = '자정';
  if (kstHour >= 6  && kstHour < 12) timeLabel = '오전';
  else if (kstHour >= 12) timeLabel = '낮';

  // 내일 예정된 미완료 수행 평가 조회
  const evalsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/evaluations?date=eq.${tomorrowStr}&is_completed=eq.false`,
    { headers },
  );
  const evals: Array<{ id: number; subject: string; title: string }> = await evalsRes.json();

  if (!evals.length) {
    return Response.json({ sent: 0, message: '내일 예정된 수행 평가 없음' });
  }

  // 모든 Push 구독 조회
  const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`, { headers });
  const subs: Array<{ id: number; endpoint: string; p256dh: string; auth: string }> = await subsRes.json();

  if (!subs.length) {
    return Response.json({ sent: 0, message: '구독된 기기 없음' });
  }

  let sent    = 0;
  const expired: number[] = [];

  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };

    for (const ev of evals) {
      const payload = JSON.stringify({
        title: `📚 수행 평가 D-1 알림 (${timeLabel})`,
        body:  `내일 ${ev.subject} — ${ev.title} 수행 평가가 있어요`,
        tag:   `eval-${ev.id}`,
        icon:  '/suhang-pyeongga-alimi/icon.svg',
      });

      try {
        await webpush.sendNotification(pushSub, payload);
        sent++;
      } catch (e: unknown) {
        const err = e as { statusCode?: number };
        if (err.statusCode === 410 || err.statusCode === 404) {
          expired.push(sub.id);
        }
      }
    }
  }

  // 만료된 구독 정리
  if (expired.length) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${expired.join(',')})`,
      { method: 'DELETE', headers },
    );
  }

  return Response.json({ sent, expired: expired.length, evals: evals.length, subs: subs.length });
});
