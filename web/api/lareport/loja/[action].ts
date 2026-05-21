// Router catch-all /loja/* (raiz) — Sprint 23.8 consolidação Vercel Hobby.
// URLs preservadas: /loja/entrada, /loja/ajuste, /loja/estorno, /loja/venda,
// /loja/transferencia, /loja/historico-vendas, /loja/buscar, /loja/buscar-cliente,
// /loja/buscar-professor. /loja/reserva (raiz) continua em loja/reserva.ts.
// /loja/reserva/cancelar e /finalizar em loja/reserva/[action].ts.
// /loja/produto/* em loja/produto/[action].ts.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  entrada,
  ajuste,
  estorno,
  venda,
  transferencia,
  historicoVendas,
  buscar,
  buscarCliente,
  buscarProfessor,
} from '../../_lib/handlers-loja.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string | undefined;
  switch (action) {
    case 'entrada':           return entrada(req, res);
    case 'ajuste':            return ajuste(req, res);
    case 'estorno':           return estorno(req, res);
    case 'venda':             return venda(req, res);
    case 'transferencia':     return transferencia(req, res);
    case 'historico-vendas':  return historicoVendas(req, res);
    case 'buscar':            return buscar(req, res);
    case 'buscar-cliente':    return buscarCliente(req, res);
    case 'buscar-professor':  return buscarProfessor(req, res);
    default:
      return res.status(404).json({ ok: false, error: 'action_not_found', action });
  }
}
