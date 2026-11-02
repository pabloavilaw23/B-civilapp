import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://xxxsighzomihflwytfbb.supabase.co';

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_mtTY5kByLnZ-H3V-b1KJHQ_EUjRrtqB';

export const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
        auth: {
            // Guarda la sesión en localStorage (sobrevive a cerrar la
            // pestaña o la app) en vez de dejarlo en el valor por
            // defecto silencioso, que en algunos navegadores/PWAs
            // instaladas no se comporta igual.
            persistSession: true,
            storage: window.localStorage,
            storageKey: 'bcivil-auth',
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    },
);