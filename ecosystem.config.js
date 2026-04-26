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
      error_file: './logs/tom-error.log',
      out_file: './logs/tom-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
