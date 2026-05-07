module.exports = {
  apps: [{
    name: 'snapcal-bot',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 20,
    min_uptime: 10000,
    watch: false,
    env: { NODE_ENV: 'production' },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
