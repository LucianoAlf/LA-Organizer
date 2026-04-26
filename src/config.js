const config = {
  port: parseInt(process.env.PORT || '3100'),
  env: process.env.NODE_ENV || 'development',
  supabase: { url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY },
  uazapi: { url: process.env.UAZAPI_URL, token: process.env.UAZAPI_TOKEN, tomPhone: process.env.TOM_PHONE || '5521997243082' },
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};
const required = [['SUPABASE_URL', config.supabase.url], ['SUPABASE_SERVICE_ROLE_KEY', config.supabase.serviceRoleKey], ['UAZAPI_URL', config.uazapi.url], ['UAZAPI_TOKEN', config.uazapi.token]];
for (const [name, value] of required) { if (!value) { console.error('Variavel faltando: ' + name); process.exit(1); } }
module.exports = config;
