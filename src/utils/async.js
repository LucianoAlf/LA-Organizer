// promiseWithTimeout: corre uma promise contra um timeout. Se a promise terminar
// antes de `ms`, resolve com o valor; senão resolve com `fallback` (default null).
// Não rejeita por timeout — quem chama trata rejeição da promise interna via .catch.
function promiseWithTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; },
    ),
    timeout,
  ]);
}

module.exports = { promiseWithTimeout };
