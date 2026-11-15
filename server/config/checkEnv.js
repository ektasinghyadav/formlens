// config/checkEnv.js - refuses to start the server with missing or placeholder settings.
// Requirements: NFR-3.3 / NFR-3.1 (secrets must be real), NFR-5.2 (clear errors on any host).
// A missing JWT_SECRET would otherwise only show up as a confusing error at the first login.
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET', 'IP_HASH_SALT', 'CLIENT_ORIGIN'];
const MIN_SECRET_LENGTH = 32;

// Returns a list of problems (empty = fine). Takes `env` as a parameter so tests can try cases.
export function envProblems(env = process.env) {
  const problems = [];
  for (const name of REQUIRED) {
    if (!env[name]) problems.push(`${name} is not set (copy .env.example to .env and fill it in)`);
  }
  for (const name of ['JWT_SECRET', 'IP_HASH_SALT', 'DB_PASSWORD']) {
    if (env[name] && /^change_me/i.test(env[name])) problems.push(`${name} is still the placeholder from .env.example`);
  }
  if (env.JWT_SECRET && env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    problems.push(`JWT_SECRET is too short (use at least ${MIN_SECRET_LENGTH} random characters)`);
  }
  return problems;
}
