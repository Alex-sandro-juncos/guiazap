// Envia notificações push de verdade (aparecem mesmo com o site fechado,
// em quem já ativou e permitiu notificações). Usa a biblioteca "web-push".

const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

exports.handler = async function (event) {
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'chaves VAPID não configuradas' }) };
    }

    webpush.setVapidDetails('mailto:contato@guiazap.shop', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const body = JSON.parse(event.body || '{}');
    const { titulo, mensagem, url, userIds, profissionalId, tipo } = body; // userIds: lista de IDs, "todos", ou use profissionalId pra notificar só quem segue essa empresa
    if (!titulo || !mensagem) {
      return { statusCode: 400, body: JSON.stringify({ error: 'título e mensagem são obrigatórios' }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    let filtroUrl = `${SUPABASE_URL}/rest/v1/push_subscriptions?select=*`;

    if (profissionalId) {
      // Busca só quem segue essa empresa específica
      const seguidoresResp = await fetch(
        `${SUPABASE_URL}/rest/v1/seguidores?profissional_id=eq.${profissionalId}&select=user_id`,
        { headers }
      );
      const seguidores = await seguidoresResp.json();
      const idsSeguidores = (seguidores || []).map(s => s.user_id);
      if (idsSeguidores.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'sem seguidores' }) };
      }
      filtroUrl += `&user_id=in.(${idsSeguidores.join(',')})`;
    } else if (userIds && userIds !== 'todos' && Array.isArray(userIds) && userIds.length > 0) {
      filtroUrl += `&user_id=in.(${userIds.join(',')})`;
    }

    const resp = await fetch(filtroUrl, { headers });
    const inscricoes = await resp.json();

    if (!inscricoes || inscricoes.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ enviados: 0, motivo: 'sem inscrições' }) };
    }

    let enviados = 0;
    for (const inscricao of inscricoes) {
      const pushSubscription = {
        endpoint: inscricao.endpoint,
        keys: { p256dh: inscricao.p256dh, auth: inscricao.auth }
      };
      const payload = JSON.stringify({ title: titulo, body: mensagem, url: url || '/', tipo: tipo || null });

      try {
        await webpush.sendNotification(pushSubscription, payload);
        enviados++;
      } catch (err) {
        // Se a inscrição não existe mais (usuário desinstalou, etc), remove do banco
        if (err.statusCode === 404 || err.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${inscricao.id}`, {
            method: 'DELETE',
            headers
          });
        } else {
          console.error('erro ao enviar push', err);
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ enviados }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};