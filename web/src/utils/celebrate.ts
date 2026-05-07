import confetti from 'canvas-confetti';

// Sprint 22.22o — Gamificacao. 3 niveis de festa quando o user completa algo.
// Usa canvas-confetti (leve, ~3kb). Em devices que respeitam prefers-reduced-motion,
// a animacao eh mais discreta (1 burst rapido em vez de cascata).

const TOM_COLORS = ['#a3e635', '#84cc16', '#65a30d', '#fde047', '#fbbf24'];

function reducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Festa pequena: tarefa concluida. Burst rapido perto da origem do clique. */
export function celebrateTask(originX?: number, originY?: number) {
  if (reducedMotion()) return;
  const x = originX != null ? originX / window.innerWidth : 0.5;
  const y = originY != null ? originY / window.innerHeight : 0.5;
  confetti({
    particleCount: 30,
    spread: 50,
    startVelocity: 25,
    origin: { x, y },
    colors: TOM_COLORS,
    ticks: 100,
    scalar: 0.7,
    disableForReducedMotion: true,
  });
}

/** Festa media: checkpoint inteiro concluido. Cascata dos dois lados. */
export function celebrateCheckpoint() {
  if (reducedMotion()) {
    confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 }, colors: TOM_COLORS });
    return;
  }
  const duration = 1200;
  const end = Date.now() + duration;
  const fire = () => {
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.7 },
      colors: TOM_COLORS,
      scalar: 0.9,
    });
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.7 },
      colors: TOM_COLORS,
      scalar: 0.9,
    });
    if (Date.now() < end) requestAnimationFrame(fire);
  };
  fire();
}

/** Festa grande: projeto 100%. Reservado pra quando computeProjectProgress fechar 100. */
export function celebrateProject() {
  if (reducedMotion()) {
    confetti({ particleCount: 80, spread: 80, origin: { y: 0.6 }, colors: TOM_COLORS });
    return;
  }
  const duration = 2500;
  const end = Date.now() + duration;
  const interval = setInterval(() => {
    if (Date.now() > end) { clearInterval(interval); return; }
    confetti({
      particleCount: 60,
      spread: 100,
      startVelocity: 35,
      origin: { x: Math.random(), y: Math.random() * 0.4 },
      colors: TOM_COLORS,
    });
  }, 250);
}
