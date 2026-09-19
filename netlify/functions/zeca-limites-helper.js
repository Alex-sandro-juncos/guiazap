// Helper compartilhado pra qualquer recurso do Zeca que precise de limite
// diário por nível de conta (hoje: geração de imagem e modo geral de
// conhecimento). Resolve quem está pedindo e quantas vezes por dia esse
// nível pode usar, sem gastar o "crédito" até o chamador confirmar que
// deu certo (ver consumirLimiteZeca).
//
// "Visitante" é controlado por IP, não por identificador do aparelho —
// um identificador mandado pelo navegador dá pra apagar/trocar fácil, e
// IP é o que realmente sustenta um limite do lado do servidor.

async function resolverNivelZeca(event, prefixoChave, limites) {
  // limites = { visitante, gratis, completo, premium } — vendas nunca
  // passa por aqui, é tratado como sem limite pelo chamador.
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headersServico = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  const authHeader = event.headers.authorization || event.headers.Authorization;
  let chaveLimite;
  let limiteDoDia;
  let nomeEmpresaParaMensagem = null;
  let usuarioIdLogado = null;

  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const usuarioResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    if (!usuarioResp.ok) {
      return { erroAuth: true };
    }
    const usuario = await usuarioResp.json();
    chaveLimite = `${prefixoChave}:user:` + usuario.id;
    usuarioIdLogado = usuario.id;

    const empresasResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profissionais?user_id=eq.${usuario.id}&status_pagamento=eq.ativo&select=name,plano,zeca_plano_pago`,
      { headers: headersServico }
    );
    const empresas = await empresasResp.json();

    const ordemPlanos = { vendas: 4, premium: 3, completo: 2, basico: 1 };
    const melhorEmpresa = (empresas || []).sort((a, b) => (ordemPlanos[b.plano] || 0) - (ordemPlanos[a.plano] || 0))[0];
    // Plano ativado MANUALMENTE ou por cupom (zeca_plano_pago = false) não
    // dá a liberdade paga no Zeca, mesmo aparecendo como pagante no resto
    // do site — só pagamento de verdade via Mercado Pago libera isso.
    // Evita, por exemplo, uma campanha de cadastro grátis (plano Vendas
    // dado de graça) virar um rombo de custo de API sem ninguém ter pago.
    const plano = melhorEmpresa && melhorEmpresa.zeca_plano_pago ? melhorEmpresa.plano : null;
    nomeEmpresaParaMensagem = melhorEmpresa ? melhorEmpresa.name : null;

    if (plano === 'vendas') {
      // Vendas tem o teto mais alto, mas NUNCA "sem limite" de verdade —
      // mesmo o plano mais caro precisa de um teto diário generoso, senão
      // uma conta comprometida (ou um uso fora do normal) vira um rombo
      // de custo de API sem fim.
      limiteDoDia = limites.vendas;
    } else if (plano === 'premium') {
      limiteDoDia = limites.premium;
    } else if (plano === 'completo') {
      limiteDoDia = limites.completo;
    } else {
      limiteDoDia = limites.gratis;
    }
  } else {
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
    chaveLimite = `${prefixoChave}:ip:` + ip;
    limiteDoDia = limites.visitante;
  }

  let registroLimiteAtual = null;
  if (limiteDoDia !== null) {
    const buscaLimiteResp = await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, { headers: headersServico });
    const registrosLimite = await buscaLimiteResp.json();
    registroLimiteAtual = registrosLimite[0] || null;

    if (registroLimiteAtual) {
      const horasPassadas = (new Date() - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
      if (horasPassadas < 24 && registroLimiteAtual.contagem >= limiteDoDia) {
        // Estourou o limite diário do plano — antes de bloquear de vez,
        // confere se a pessoa (só quem tá logado, visitante não compra
        // crédito) tem saldo de créditos extras comprados avulso.
        if (usuarioIdLogado) {
          const credito = await verificarCreditoZeca(usuarioIdLogado, headersServico, SUPABASE_URL);
          if (credito.saldo > 0) {
            return {
              autorizado: true,
              limiteDoDia,
              chaveLimite,
              registroLimiteAtual,
              nomeEmpresaParaMensagem,
              headersServico,
              SUPABASE_URL,
              usandoCredito: true,
              usuarioIdLogado
            };
          }
        }
        return {
          autorizado: false,
          limiteDoDia,
          logado: !!authHeader,
          semCredito: !!usuarioIdLogado
        };
      }
    }
  }

  return {
    autorizado: true,
    limiteDoDia,
    chaveLimite,
    registroLimiteAtual,
    nomeEmpresaParaMensagem,
    headersServico,
    SUPABASE_URL
  };
}

// Créditos extras comprados avulso (pacote fixo via Mercado Pago) — usados
// só como fallback quando o limite diário normal do plano já estourou.
async function verificarCreditoZeca(usuarioId, headersServico, SUPABASE_URL) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/zeca_creditos_extras?user_id=eq.${usuarioId}`, { headers: headersServico });
  const lista = await resp.json();
  const registro = (lista && lista[0]) || null;
  return { saldo: registro ? registro.saldo : 0, registro };
}

// Só chama isso DEPOIS que o recurso foi entregue com sucesso, igual o
// consumirLimiteZeca normal — desconta créditos do saldo da pessoa.
// "quantidade" existe porque recursos mais caros (vídeo) consomem mais de
// 1 crédito por uso — o padrão (1) serve pra imagem/áudio.
async function consumirCreditoZeca(usuarioId, headersServico, SUPABASE_URL, quantidade) {
  const { saldo, registro } = await verificarCreditoZeca(usuarioId, headersServico, SUPABASE_URL);
  const novoSaldo = Math.max(0, saldo - (quantidade || 1));
  if (registro) {
    await fetch(`${SUPABASE_URL}/rest/v1/zeca_creditos_extras?user_id=eq.${usuarioId}`, {
      method: 'PATCH', headers: headersServico, body: JSON.stringify({ saldo: novoSaldo, updated_at: new Date().toISOString() })
    });
  }
}

// Só chama isso DEPOIS que o recurso foi entregue com sucesso — nunca
// antes, senão a pessoa perde a vez em caso de erro do lado de fora
// (ex: a IA ou a geração de imagem falhar).
async function consumirLimiteZeca({ limiteDoDia, chaveLimite, registroLimiteAtual, headersServico, SUPABASE_URL, usandoCredito, usuarioIdLogado }) {
  if (usandoCredito && usuarioIdLogado) {
    return consumirCreditoZeca(usuarioIdLogado, headersServico, SUPABASE_URL);
  }
  if (limiteDoDia === null) return; // Pacote Vendas — nada pra descontar

  const agora = new Date();
  if (registroLimiteAtual) {
    const horasPassadas = (agora - new Date(registroLimiteAtual.janela_inicio)) / 3600000;
    const novaContagem = horasPassadas >= 24 ? 1 : registroLimiteAtual.contagem + 1;
    const novaJanela = horasPassadas >= 24 ? agora.toISOString() : registroLimiteAtual.janela_inicio;
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico?chave=eq.${encodeURIComponent(chaveLimite)}`, {
      method: 'PATCH', headers: headersServico, body: JSON.stringify({ contagem: novaContagem, janela_inicio: novaJanela })
    });
  } else {
    await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_publico`, {
      method: 'POST', headers: headersServico, body: JSON.stringify({ chave: chaveLimite, contagem: 1, janela_inicio: agora.toISOString() })
    });
  }
}

module.exports = { resolverNivelZeca, consumirLimiteZeca, verificarCreditoZeca, consumirCreditoZeca };