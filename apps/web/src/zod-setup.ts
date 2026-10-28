import { config } from 'zod';

// The server's Content-Security-Policy forbids eval, so zod must not probe for
// it. Imported before anything that defines schemas.
config({ jitless: true });
