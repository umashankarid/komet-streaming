/**
 * Generate an ADMIN_PASSWORD_HASH value for deployment.
 *
 *   npm run hash-password -- "your-password"
 *
 * Copy the printed "salt:hash" into the ADMIN_PASSWORD_HASH env var (Coolify).
 */
import { hashPassword } from "../src/api/auth.js";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(1);
}

console.log(hashPassword(password));
