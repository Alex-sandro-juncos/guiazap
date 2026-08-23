// Gera o sitemap.xml na hora, listando cada combinação real de categoria+cidade
// que existe no banco de dados (além das páginas fixas do site), pra ajudar o
// Google a indexar cada página de busca específica.

function normalizarSlug(str){
  return (str || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

exports.handler = async function () {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };

    const [profissionaisResp, blogResp] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profissionais?status_pagamento=eq.ativo&select=cat,cidade`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/blog_posts?aprovado=eq.true&select=slug,created_at`, { headers })
    ]);
    const profissionais = await profissionaisResp.json();
    const posts = await blogResp.json();

    const combos = new Set();
    (profissionais || []).forEach(p => {
      if (p.cat && p.cidade) {
        const slug = `${normalizarSlug(p.cat)}-${normalizarSlug(p.cidade)}`;
        if (slug.length > 1) combos.add(slug);
      }
    });

    const urlsCategoria = Array.from(combos).map(slug => `
  <url>
    <loc>https://guiazap.shop/${slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');

    const urlsBlog = (posts || []).map(p => `
  <url>
    <loc>https://guiazap.shop/blog/${p.slug}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`).join('');

    const paginasFixas = [
      ['', '1.0', 'daily'],
      ['vitrine.html', '0.9', 'daily'],
      ['vagas.html', '0.9', 'daily'],
      ['blog.html', '0.8', 'weekly'],
      ['talentos.html', '0.7', 'daily'],
      ['curriculo.html', '0.6', 'monthly'],
      ['depoimentos.html', '0.6', 'weekly'],
      ['sobre.html', '0.7', 'monthly'],
      ['pacotes.html', '0.7', 'monthly'],
      ['contato.html', '0.5', 'monthly'],
      ['app.html', '0.5', 'monthly'],
      ['termos.html', '0.3', 'yearly'],
      ['privacidade.html', '0.3', 'yearly']
    ];

    const urlsFixas = paginasFixas.map(([caminho, prioridade, freq]) => `
  <url>
    <loc>https://guiazap.shop/${caminho}</loc>
    <changefreq>${freq}</changefreq>
    <priority>${prioridade}</priority>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlsFixas}${urlsCategoria}${urlsBlog}
</urlset>`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      body: xml
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: 'erro ao gerar sitemap: ' + err.message };
  }
};