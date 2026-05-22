module.exports = {
  apps: [
    {
      name: 'tom',
      script: 'src/index.js',
      cwd: '/opt/LA-Organizer',
      instances: 1,
      exec_mode: 'fork',
      // Node 20+ carrega o .env nativamente; mantém paridade com o setup atual.
      node_args: ['--env-file=.env'],
      max_memory_restart: '500M',
      autorestart: true,
      // Sprint 23.14 — graceful shutdown: PM2 espera até 35s pra o processo
      // sair limpo (SIGTERM → shutdown.installGracefulShutdown aguarda fila
      // esvaziar por 30s) antes de mandar SIGKILL. wait_ready=true espera
      // o processo emitir process.send('ready') antes de marcar como online.
      kill_timeout: 35000,
      wait_ready: true,
      listen_timeout: 10000,
      error_file: './logs/tom-error.log',
      out_file: './logs/tom-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
