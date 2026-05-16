import { useQuery } from '@tanstack/react-query';
import {
  fetchJourneyCheckpoints, fetchJourneyCursos, fetchJourneyMentoresPorCurso,
  fetchJourneyConteudoCompleto, fetchJourneyListaProgresso, fetchJourneyPendencias,
} from '../lib/lajourney';
import type { Programa } from '../lib/lajourney-types';

export function useJourneyCheckpoints(programaId: Programa) {
  return useQuery({
    queryKey: ['lajourney-checkpoints', programaId],
    queryFn: () => fetchJourneyCheckpoints(programaId),
    staleTime: 60 * 60_000,
  });
}

export function useJourneyCursos(programaId: Programa) {
  return useQuery({
    queryKey: ['lajourney-cursos', programaId],
    queryFn: () => fetchJourneyCursos(programaId),
    staleTime: 5 * 60_000,
  });
}

export function useJourneyMentores(programaId: Programa, cursoId: string | null) {
  return useQuery({
    queryKey: ['lajourney-mentores', programaId, cursoId],
    queryFn: () => fetchJourneyMentoresPorCurso(programaId, cursoId!),
    enabled: !!cursoId,
    staleTime: 5 * 60_000,
  });
}

export function useJourneyConteudo(programaId: Programa, cursoId: string | null, checkpointId: string | null) {
  return useQuery({
    queryKey: ['lajourney-conteudo', programaId, cursoId, checkpointId],
    queryFn: () => fetchJourneyConteudoCompleto(programaId, cursoId!, checkpointId!),
    enabled: !!cursoId && !!checkpointId,
    staleTime: 0,
  });
}

export function useJourneyListaProgresso(programaId: Programa) {
  return useQuery({
    queryKey: ['lajourney-lista-progresso', programaId],
    queryFn: () => fetchJourneyListaProgresso(programaId),
    staleTime: 30_000,
  });
}

export function useJourneyPendencias() {
  return useQuery({
    queryKey: ['lajourney-pendencias'],
    queryFn: fetchJourneyPendencias,
    staleTime: 30_000,
  });
}
