// Router catch-all /loja/reserva/* — Sprint 23.8 consolidação Vercel Hobby.
// URLs preservadas: /loja/reserva/cancelar, /loja/reserva/finalizar.
// /loja/reserva (raiz) continua em loja/reserva.ts.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  reservaCancelar,
  reservaFinalizar,
} from '../../../_lib/handlers-loja-reserva.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = req.query.action as string | undefined;
  switch (action) {
    case 'cancelar':  return reservaCancelar(req, res);
    case 'finalizar': return reservaFinalizar(req, res);
    default:
      return res.status(404).json({ ok: false, error: 'action_not_found', action });
  }
}
