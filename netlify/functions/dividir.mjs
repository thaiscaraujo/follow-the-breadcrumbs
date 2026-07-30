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
      "impacto": "baixo | medio | alto",
      "prazo": "YYYY-MM-DD se o texto indicar prazo, senão null"
    }
  ]
}

Regras:
- Uma "sessão" é um bloco curto com fim claro (poucos minutos a ~45 min). Se o item é grande, quebre em várias sessões pequenas, na ordem de execução.
- IMPORTANTE — mantenha o CONTEXTO do item original. O "titulo" deve ser específico e se explicar sozinho, incluindo o assunto/objeto concreto do texto original. NUNCA use títulos genéricos como "Fazer ligação", "Organizar", "Enviar e-mail". Ex.: se o item é "ligar pra mãe sobre o aniversário", o título é "Ligar para a mãe sobre o aniversário", não "Fazer ligação".
- "passos": ações concretas e literais, começando por um verbo, também mencionando o assunto concreto. Nada de reflexão ("pensar sobre", "analisar", "entender") — só ação física/observável.
- "energiaMin"/"cognicaoMin": o mínimo necessário. Tarefas mecânicas = baixa; tarefas que exigem foco/decisão = alta.
- "impacto": deduza do texto (algo importante/urgente/para o chefe = alto; trivial = baixo).
- "prazo": preencha no formato YYYY-MM-DD, senão null. Regras:
  (a) Data explícita "dia/mês" (ex.: "14/08", "20/12"): use EXATAMENTE esse dia e mês, no ano atual (ou no próximo ano se a data já passou). Ex.: "14/08" com hoje em 2026 => "2026-08-14".
  (b) Nome de dia da semana ("sexta", "segunda", "quinta"...): use EXATAMENTE a data da tabela "Próximas ocorrências" fornecida na mensagem (é a ocorrência mais próxima, dentro dos próximos 7 dias — a MESMA semana). NUNCA pule para a semana seguinte. "amanhã" = a data de amanhã informada. "hoje" = a data de hoje.
  (c) IMPORTANTE: quando o texto contém VÁRIAS tarefas distintas, cada tarefa usa o prazo mencionado JUNTO DELA. NÃO aplique o prazo de uma tarefa às outras. Uma tarefa sem prazo próprio fica com null.
- "tempoEstimadoMin": um número realista (5, 10, 15, 25 ou 45).
- Escreva tudo em português simples e acolhedor.`;

function refSemana() {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const base = new Date(iso + 'T12:00:00Z'); // meio-dia UTC evita erro de fuso
  const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const diaSemana = nomes[base.getUTCDay()];
  const map = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    const nome = nomes[d.getUTCDay()];
    if (!(nome in map)) map[nome] = d.toISOString().slice(0, 10); // 1ª ocorrência = mais próxima
  }
  const amanha = new Date(base.getTime() + 86400000).toISOString().slice(0, 10);
  const tabela = Object.entries(map).map(([k, v]) => `${k}=${v}`).join(', ');
  return { iso, diaSemana, amanha, tabela };
}

export default async (req) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return json({ erro: 'sem_chave', mensagem: 'Chave da IA não configurada.' }, 503);

  if (req.method !== 'POST') return json({ erro: 'metodo nao suportado' }, 405);

  let body;
  try { body = await req.json(); } catch (e) { body = null; }
  const texto = body && typeof body.texto === 'string' ? body.texto.trim() : '';
  if (!texto) return json({ erro: 'texto faltando' }, 400);

  const { iso, diaSemana, amanha, tabela } = refSemana();

  const payload = {
    model: 'llama-3.3-70b-versatile',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: INSTRUCAO },
      { role: 'user', content: `Hoje é ${iso} (${diaSemana}). amanhã=${amanha}. Próximas ocorrências dos dias da semana (use estas datas exatas): ${tabela}. Item da Entrada: "${texto}". Responda em JSON.` }
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
