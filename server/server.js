// server.js - starts the HTTP server. Requirement: NFR-5.2 (runs on any standard Node host).
import app from './app.js';
import { envProblems } from './config/checkEnv.js';

const problems = envProblems();
if (problems.length) {
  console.error('The server cannot start:\n - ' + problems.join('\n - '));
  process.exit(1);
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`DFUA API listening on http://localhost:${port}/api/v1`));
