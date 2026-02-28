// database.js (COMPLETE FULL-LENGTH VERSION)
const { Pool } = require('pg');
const secrets = require('./secrets.js');

let pool;

function getDb() {
    if (!pool) {
        if (!secrets.DATABASE_URL) {
            console.error("FATAL ERROR: DATABASE_URL is not found in secrets.js!");
            process.exit(1);
        }
        pool = new Pool({
            connectionString: secrets.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
    }
    return pool;
}

/**
 * Sets up all tables in Supabase. 
 * This is "idempotent," meaning it won't delete data if the tables already exist.
 */
async function setupDatabase() {
    const client = await getDb().connect();
    try {
        console.log('Synchronizing Database Schema...');
        await client.query('BEGIN');
        
        // 1. Core Tables
        await client.query(`CREATE TABLE IF NOT EXISTS admins (user_id TEXT PRIMARY KEY, gcash_number TEXT, is_online BOOLEAN DEFAULT FALSE)`);
        await client.query(`CREATE TABLE IF NOT EXISTS mods (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, price REAL DEFAULT 0, image_url TEXT, default_claims_max INTEGER DEFAULT 3, x_coordinate REAL, y_coordinate REAL)`);
        await client.query(`CREATE TABLE IF NOT EXISTS accounts (id SERIAL PRIMARY KEY, mod_id INTEGER NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, is_available BOOLEAN DEFAULT TRUE, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        await client.query(`CREATE TABLE IF NOT EXISTS "references" (ref_number TEXT PRIMARY KEY, user_id TEXT NOT NULL, mod_id INTEGER NOT NULL, timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, claims_used INTEGER DEFAULT 0, claims_max INTEGER DEFAULT 1, last_replacement_timestamp TIMESTAMPTZ, FOREIGN KEY (mod_id) REFERENCES mods(id))`);
        await client.query(`CREATE TABLE IF NOT EXISTS creation_jobs ( job_id SERIAL PRIMARY KEY, user_psid TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, mod_id INTEGER NOT NULL, status VARCHAR(20) DEFAULT 'pending', result_message TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP )`);
        
        // 2. Settings & Users
        await client.query(`CREATE TABLE IF NOT EXISTS paused_users (user_id TEXT PRIMARY KEY)`);
        await client.query(`CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)`);
        await client.query(`INSERT INTO app_settings (key, value) VALUES ('maintenance_mode', 'false') ON CONFLICT (key) DO NOTHING`);
        await client.query(`CREATE TABLE IF NOT EXISTS users (psid TEXT PRIMARY KEY, lang TEXT DEFAULT 'en')`);
        
        await client.query('COMMIT');

        // 3. Ensure columns exist (for older database versions)
        try { await client.query('ALTER TABLE admins ADD COLUMN is_online BOOLEAN DEFAULT FALSE'); } catch (e) {}
        try { await client.query('ALTER TABLE mods ADD COLUMN x_coordinate REAL'); await client.query('ALTER TABLE mods ADD COLUMN y_coordinate REAL'); } catch (e) {}
        try { await client.query('ALTER TABLE "references" ADD COLUMN last_replacement_timestamp TIMESTAMPTZ'); } catch (e) {}
        try { await client.query('ALTER TABLE users ADD COLUMN lang TEXT DEFAULT \'en\''); } catch (e) {}
        
        console.log('✅ Database synchronized successfully.');
    } catch (error) { 
        await client.query('ROLLBACK'); 
        console.error('FATAL: Database synchronization failed:', error.message); 
        throw error; 
    } finally { 
        client.release(); 
    }
}

// --- AUTOMATION & JOB POLLING FUNCTIONS ---

async function createAccountCreationJob(user_psid, email, password, modId) {
    const query = 'INSERT INTO creation_jobs (user_psid, email, password, mod_id, status) VALUES ($1, $2, $3, $4, \'pending\') RETURNING job_id';
    const res = await getDb().query(query, [user_psid, email, password, modId]);
    return res.rows[0].job_id;
}

async function getJobById(jobId) {
    const res = await getDb().query('SELECT * FROM creation_jobs WHERE job_id = $1', [jobId]);
    return res.rows[0];
}

async function updateJobStatus(jobId, newStatus, resultMessage = null) {
    const query = 'UPDATE creation_jobs SET status = $1, result_message = $2, updated_at = CURRENT_TIMESTAMP WHERE job_id = $3';
    await getDb().query(query, [newStatus, resultMessage, jobId]);
}

async function getPendingJobsForWorker() {
    const res = await getDb().query(`SELECT * FROM creation_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5`);
    return res.rows;
}

async function getActionableJobs() {
    // Used by job_poller.js to find jobs that need a message sent to the user
    const res = await getDb().query("SELECT * FROM creation_jobs WHERE status IN ('completed', 'failed')");
    return res.rows;
}

async function getStalePendingJobs(minutes) {
    // Alerts admin if worker is offline
    const res = await getDb().query(`SELECT * FROM creation_jobs WHERE status = 'pending' AND created_at < NOW() - INTERVAL '${minutes} minutes'`);
    return res.rows;
}

async function getCreationJobs() {
    // Admin View
    const res = await getDb().query('SELECT job_id, user_psid, status, result_message FROM creation_jobs ORDER BY created_at DESC LIMIT 15');
    return res.rows;
}

// --- ADMIN & APP SETTINGS ---

async function isAdmin(userId) {
    const res = await getDb().query('SELECT * FROM admins WHERE user_id = $1', [userId]);
    return res.rows[0] || null;
}

async function getAdminInfo() {
    const res = await getDb().query('SELECT * FROM admins LIMIT 1');
    return res.rows[0] || null;
}

async function updateAdminInfo(userId, gcashNumber) {
    await getDb().query('INSERT INTO admins (user_id, gcash_number) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET gcash_number = $2', [userId, gcashNumber]);
}

async function setAdminOnlineStatus(isOnline) {
    await getDb().query('UPDATE admins SET is_online = $1', [isOnline]);
}

async function getMaintenanceStatus() {
    const res = await getDb().query("SELECT value FROM app_settings WHERE key = 'maintenance_mode'");
    return res.rows[0]?.value === 'true';
}

async function setMaintenanceStatus(isMaintenance) {
    await getDb().query("UPDATE app_settings SET value = $1 WHERE key = 'maintenance_mode'", [isMaintenance]);
}

// --- MOD & INVENTORY MANAGEMENT ---

async function getMods() {
    const query = `
        SELECT m.id, m.name, m.description, m.price, m.image_url, m.default_claims_max, 
        (SELECT COUNT(*) FROM accounts WHERE mod_id = m.id AND is_available = TRUE) as stock 
        FROM mods m ORDER BY m.id`;
    const res = await getDb().query(query);
    return res.rows;
}

async function getModById(modId) {
    const res = await getDb().query('SELECT * FROM mods WHERE id = $1', [modId]);
    return res.rows[0] || null;
}

async function getModsByPrice(price) {
    const res = await getDb().query('SELECT * FROM mods WHERE price BETWEEN $1 AND $2', [price - 0.01, price + 0.01]);
    return res.rows;
}

async function addMod(id, name, desc, price, img, claims) {
    await getDb().query('INSERT INTO mods (id, name, description, price, image_url, default_claims_max) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(id) DO NOTHING', [id, name, desc, price, img, claims]);
}

async function updateModDetails(modId, details) {
    const fields = Object.keys(details).map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = Object.values(details);
    await getDb().query(`UPDATE mods SET ${fields} WHERE id = $${values.length + 1}`, [...values, modId]);
}

// --- ACCOUNT & REFERENCE MANAGEMENT ---

async function addBulkAccounts(modId, accounts) {
    const client = await getDb().connect();
    try {
        await client.query('BEGIN');
        for (const acc of accounts) {
            await client.query('INSERT INTO accounts (mod_id, username, password) VALUES ($1, $2, $3)', [modId, acc.username, acc.password]);
        }
        await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function addReference(ref, userId = 'ADMIN_ADDED', modId) {
    const mod = await getModById(modId);
    if (!mod) throw new Error(`Mod ${modId} not found.`);
    const claimsMax = mod.default_claims_max || 1;
    const res = await getDb().query('INSERT INTO "references" (ref_number, user_id, mod_id, claims_max) VALUES ($1, $2, $3, $4) ON CONFLICT (ref_number) DO NOTHING', [ref, userId, modId, claimsMax]);
    if (res.rowCount === 0) throw new Error('Duplicate reference number');
    return claimsMax;
}

async function getReference(refNumber) {
    const query = 'SELECT r.*, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id WHERE r.ref_number = $1';
    const res = await getDb().query(query, [refNumber]);
    return res.rows[0] || null;
}

async function getAllReferences() {
    const query = 'SELECT r.ref_number, r.user_id, r.claims_used, r.claims_max, m.name as mod_name FROM "references" r JOIN mods m ON r.mod_id = m.id ORDER BY r.timestamp DESC';
    const res = await getDb().query(query);
    return res.rows;
}

async function deleteReference(refNumber) {
    const res = await getDb().query('DELETE FROM "references" WHERE ref_number = $1', [refNumber]);
    return res.rowCount;
}

async function getAvailableAccount(modId) {
    const res = await getDb().query('SELECT * FROM accounts WHERE mod_id = $1 AND is_available = TRUE LIMIT 1', [modId]);
    return res.rows[0] || null;
}

async function claimAccount(accountId) {
    await getDb().query('UPDATE accounts SET is_available = FALSE WHERE id = $1', [accountId]);
}

async function useClaim(refNumber) {
    await getDb().query('UPDATE "references" SET claims_used = claims_used + 1, last_replacement_timestamp = CURRENT_TIMESTAMP WHERE ref_number = $1', [refNumber]);
}

async function updateReferenceMod(ref, newModId) {
    await getDb().query('UPDATE "references" SET mod_id = $1 WHERE ref_number = $2', [newModId, ref]);
}

async function updateReferenceClaims(ref, used, max) {
    const res = await getDb().query('UPDATE "references" SET claims_used = $1, claims_max = $2 WHERE ref_number = $3', [used, max, ref]);
    return res.rowCount;
}

async function deleteAccountsByModId(modId) {
    const res = await getDb().query('DELETE FROM accounts WHERE mod_id = $1 AND is_available = TRUE', [modId]);
    return res.rowCount;
}

// --- USER MANAGEMENT ---

async function addUser(psid, lang = 'en') {
    await getDb().query('INSERT INTO users (psid, lang) VALUES ($1, $2) ON CONFLICT (psid) DO UPDATE SET lang = EXCLUDED.lang', [psid, lang]);
}

async function getUser(psid) {
    const res = await getDb().query('SELECT * FROM users WHERE psid = $1', [psid]);
    return res.rows[0] || null;
}

async function getAllUserPsids() {
    const res = await getDb().query('SELECT psid FROM users');
    return res.rows.map(row => row.psid);
}

async function isUserPaused(userId) {
    const res = await getDb().query('SELECT user_id FROM paused_users WHERE user_id = $1', [userId]);
    return res.rowCount > 0;
}

async function pauseUser(userId) {
    await getDb().query('INSERT INTO paused_users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function resumeUser(userId) {
    await getDb().query('DELETE FROM paused_users WHERE user_id = $1', [userId]);
}

// --- REPORTING ---

async function getSalesStatistics(period) {
    const interval = { 'daily': '1 day', 'weekly': '7 days', 'monthly': '30 days' }[period];
    if (!interval) throw new Error('Invalid period.');
    const query = `
        SELECT m.name, COUNT(r.ref_number) as sales_count, SUM(m.price) as total_revenue
        FROM "references" r
        JOIN mods m ON r.mod_id = m.id
        WHERE r.timestamp >= NOW() - INTERVAL '${interval}'
        GROUP BY m.name
        ORDER BY total_revenue DESC;
    `;
    const res = await getDb().query(query);
    return res.rows;
}

module.exports = {
    setupDatabase,
    createAccountCreationJob,
    getJobById,
    updateJobStatus,
    getPendingJobsForWorker,
    getActionableJobs,
    getStalePendingJobs,
    getCreationJobs,
    isAdmin,
    getAdminInfo,
    updateAdminInfo,
    setAdminOnlineStatus,
    getMaintenanceStatus,
    setMaintenanceStatus,
    getMods,
    getModById,
    getModsByPrice,
    addMod,
    updateModDetails,
    addBulkAccounts,
    addReference,
    getReference,
    getAllReferences,
    deleteReference,
    getAvailableAccount,
    claimAccount,
    useClaim,
    updateReferenceMod,
    updateReferenceClaims,
    deleteAccountsByModId,
    addUser,
    getUser,
    getAllUserPsids,
    isUserPaused,
    pauseUser,
    resumeUser,
    getSalesStatistics
}; 
