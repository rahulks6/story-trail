import { queryOne } from "../src/db/psql";
// Operator-only bootstrap: existing account, no default credentials, no public promotion API.
async function main() {
    const email = process.argv[2];
    if (!email)
        throw new Error('Usage: node dist/scripts/bootstrap-super-admin.js existing-account-email');
    const row = await queryOne(`SELECT bootstrap_super_admin(:'email') AS user_id`, { email });
    if (!row?.user_id)
        throw new Error('No change: active account not found or a Super Admin already exists.');
    console.log('Initial Super Admin created. Sign in at /admin/login.');
}
void main().catch(e => { console.error(e instanceof Error ? e.message : 'Bootstrap failed'); process.exitCode = 1; });
