#!/usr/bin/env node
'use strict';
// gov-runner.js — roda UM ciclo do agente de governança, em processo próprio.
//
// POR QUE UM PROCESSO SEPARADO, E NÃO DENTRO DO TICK DO DISPATCHER
// O cron do dispatcher roda sob `flock -n /tmp/la-dispatcher.lock` a cada 5 min. Um ciclo de
// governança leva minutos (refutar + reproduzir + corrigir + suíte inteira; o teto é 30 min).
// Se o tick esperasse por ele, o lock ficaria preso esse tempo todo e TODO o resto do
// dispatcher — lembretes, fila do LA EDUCA ("latência max 5min"), rituais — seria pulado por
// ~6 ticks toda manhã. E não dá pra só não esperar: o dispatcher termina em `process.exit(0)`,
// que mata o `.then()` que posta o resultado. Era assim que um pedido do Alf sumiu em silêncio
// em 08/08 19:29.
//
// Então o tick só DISPARA este processo (detached) e sai. Quem segura o tempo é aqui.
//
// Env e data vêm de fora de propósito: o pai passa o próprio `process.env` (já com o .env
// carregado) e o `--ymd` que ele calculou, então não há um segundo cálculo de data pra
// divergir do dispatcher — nem um toISOString().slice(0,10) que erraria o dia depois das 21h.
//
// Concorrência: o dispatcher chama isto sob `flock -n /tmp/la-gov.lock`. Segundo tick não
// entra. O gate de idempotência aqui dentro é a segunda trava, para o caso do lock estar livre
// porque o ciclo do dia já terminou.

const supabase = require('../supabase/client');
const { rodarCicloGovernanca } = require('../services/governance-agent');
const { postOpsResult } = require('../services/group-chat-engine');

function arg(nome) {
  const p = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return p ? p.slice(nome.length + 3) : '';
}

async function main() {
  const grupo = (process.env.TOM_OPS_GROUP_ID || '').trim();
  const ymd = arg('ymd');
  if (!grupo) return console.error('[GovRunner] sem TOM_OPS_GROUP_ID — nada a fazer');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return console.error(`[GovRunner] --ymd inválido: "${ymd}"`);

  // quiet-exempt: canal de engenharia do Alf e do Hugo, não é envio a colaborador.
  const postar = (txt) => postOpsResult(supabase, grupo, txt);
  const force = process.argv.includes('--force');

  try {
    const r = await rodarCicloGovernanca(supabase, { ymd, force, postar });
    console.log(`[GovRunner] ${ymd} ${JSON.stringify(r)}`);
  } catch (e) {
    // Falhar calado é o pior desfecho: ninguém olha log, e o grupo assume que rodou.
    console.error('[GovRunner] ciclo quebrou:', e.stack || e.message);
    try {
      await postar(`⚠️ O ciclo de governança de hoje quebrou no meio: ${e.message}\n\n`
        + 'Não confie em nada dele. Vou tentar de novo amanhã.');
    } catch (e2) {
      console.error('[GovRunner] nem o aviso foi:', e2.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[GovRunner] erro fatal:', e); process.exit(1); });
