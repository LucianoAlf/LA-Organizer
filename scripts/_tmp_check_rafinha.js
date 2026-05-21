const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('collaborators')
  .select('id,full_name,role,function_role,pedagogical_role,unit,is_active')
  .or('full_name.ilike.%rafinha%,full_name.ilike.%rafael%')
  .then(({ data, error }) => {
    console.log(JSON.stringify({ data, error }, null, 2));
    process.exit(0);
  });
