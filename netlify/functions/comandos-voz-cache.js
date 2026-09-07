// Cache de comandos de voz no Supabase.
// Não guarda dado pessoal. Não reaproveita resposta com id dinâmico
// (produto, empresa, pedido) — isso muda de tela pra tela.

function normalizarTexto(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resultadoTemIdDinamico(resultado) {
  if (!resultado || typeof resultado !== 'object') return false;
  const params = resultado.params || {};
  const chavesId = ['id', 'produto_id', 'profissional_id', 'pedido_id'];
  return chavesId.some((k) => params[k]);
}

function ehCacheavel(resultado) {
  if (!resultado || typeof resultado !== 'object') return false;
  if (resultadoTemIdDinamico(resultado)) return false;
  return true;
}

function headersServico() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

async function buscarCache(escopo, textoNormalizado) {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !textoNormalizado) return null;

  try {
    const resp = await fetch(
      `${url}/rest/v1/comandos_voz?escopo=eq.${encodeURIComponent(escopo)}&texto_normalizado=eq.${encodeURIComponent(textoNormalizado)}&status=eq.approved&select=id,resultado,hit_count,cacheavel`,
      { headers: headersServico() }
    );
    const rows = await resp.json();
    const row = rows && rows[0];
    if (!row || !row.cacheavel) return null;

    fetch(`${url}/rest/v1/comandos_voz?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: headersServico(),
      body: JSON.stringify({ hit_count: (row.hit_count || 0) + 1, updated_at: new Date().toISOString() })
    }).catch(() => {});

    return row.resultado;
  } catch (e) {
    console.warn('cache voz busca falhou', e);
    return null;
  }
}

async function salvarPending(escopo, textoNormalizado, textoOriginal) {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !textoNormalizado) return;

  try {
    const busca = await fetch(
      `${url}/rest/v1/comandos_voz_pending?escopo=eq.${encodeURIComponent(escopo)}&texto_normalizado=eq.${encodeURIComponent(textoNormalizado)}&select=id,vezes`,
      { headers: headersServico() }
    );
    const rows = await busca.json();
    if (rows && rows[0]) {
      await fetch(`${url}/rest/v1/comandos_voz_pending?id=eq.${rows[0].id}`, {
        method: 'PATCH',
        headers: headersServico(),
        body: JSON.stringify({
          vezes: (rows[0].vezes || 1) + 1,
          texto_original: textoOriginal || null,
          updated_at: new Date().toISOString()
        })
      });
      return;
    }
    await fetch(`${url}/rest/v1/comandos_voz_pending`, {
      method: 'POST',
      headers: headersServico(),
      body: JSON.stringify({
        escopo,
        texto_normalizado: textoNormalizado,
        texto_original: textoOriginal || null,
        vezes: 1
      })
    });
  } catch (e) {
    console.warn('cache voz pending falhou', e);
  }
}

async function salvarAprovado(escopo, textoNormalizado, resultado) {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !textoNormalizado) return;
  if (!ehCacheavel(resultado)) return;

  try {
    await fetch(`${url}/rest/v1/comandos_voz?on_conflict=escopo,texto_normalizado`, {
      method: 'POST',
      headers: { ...headersServico(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        escopo,
        texto_normalizado: textoNormalizado,
        resultado,
        cacheavel: true,
        status: 'approved',
        updated_at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn('cache voz save falhou', e);
  }
}

module.exports = {
  normalizarTexto,
  ehCacheavel,
  buscarCache,
  salvarPending,
  salvarAprovado
};
