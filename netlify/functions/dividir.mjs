// Bastidores: usa a IA (Groq, gratuito) para transformar um item bagunçado da Entrada
// em uma ou mais SESSÕES prontas (com critério de conclusão, "não faz parte", passos, etc).
// A chave da IA fica só aqui no servidor, nunca aparece para o navegador.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const INSTRUCAO = `Você ajuda uma pessoa com dificuldade de função executiva (TDAH) a sair da análise e entrar em ação.
Recebe um item solto e bagunçado que ela precisa fazer. Sua tarefa: transformá-lo em UMA OU MAIS sessões executáveis.

Responda SOMENTE com um objeto JSON neste formato exato:
{
  "sessoes": [
    {
      "titulo": "string curto",
      "area": "uma palavra: Trabalho, Casa, Saúde, Pessoal, Estudos ou Finanças",
      "criterioConclusao": "como sei que posso parar? objetivo e verificável",
      "naoFazParte": "o que NÃO fazer nesta sessão (ou string vazia)",
      "passos": ["2 a 5 ações concretas no imperativo"],
      "tempoEstimadoMin": 15,
      "energiaMin": "baixa | media | alta",
      "cognicaoMin": "baixa | media | alta",
      "impacto": "baixo | medio | alto"
    }
  ]
}

Regras:
- Uma "sessão" é um bloco curto com fim claro (poucos minutos a ~45 min). Se o item é grande, quebre em várias sessões pequenas, na ordem de execução.
- "passos": ações concretas e literais, começando por um verbo. Nada de reflexão ("pensar sobre", "analisar", "entender") — só ação física/observável.
- "energiaMin"/"cognicaoMin": o mínimo necessário. Tarefas mecânicas = baixa; tarefas que exigem foco/decisão = alta.
- "tempoEstimadoMin": um número realista (5, 10, 15, 25 ou 45).
- Escreva tudo em português simples e acolhedor.`;

export default async (req) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return json({ erro: 'sem_chave', mensagem: 'Chave da IA não configurada.' }, 503);

  if (req.method !== 'POST') return json({ erro: 'metodo nao suportado' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = null; }
  const texto = body && typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto) return json({ erro: 'texto faltando' }, 400);

  const payload = {
    model: 'llama-3.3-70b-versatile',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INSTRUCAO },
      { role: 'user', content: `Item da Entrada: "${texto}". Responda em JSON.` }
    ]
  };

  let resp;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({ erro: 'falha_rede', mensagem: 'Não consegui falar com a IA.' }, 502);
  }

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    return json({ erro: 'falha_ia', status: resp.status, detalhe: detalhe.slice(0, 500) }, 502);
  }

  let data;
  try { data = await resp.json(); } catch (e) { return json({ erro: 'resposta_invalida' }, 502); }

  const txt = data?.choices?.[0]?.message?.content;
  if (!txt) return json({ erro: 'resposta_vazia' }, 502);

  let parsed;
  try { parsed = JSON.parse(txt); } catch (e) { return json({ erro: 'json_invalido', bruto: txt.slice(0, 500) }, 502); }

  const sessoes = Array.isArray(parsed.sessoes) ? parsed.sessoes : [];
  if (!sessoes.length) return json({ erro: 'sem_sessoes' }, 502);

  return json({ sessoes });
};
