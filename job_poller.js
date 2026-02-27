// job_poller.js (FIXED & COMPLETE)
const dbManager = require('./database.js');
const lang = require('./language_manager.js');
const { sendText } = require('./messenger_api.js');
const { ADMIN_ID } = require('./secrets.js');

const POLLING_INTERVAL = 15 * 1000; // 15 seconds
const OFFLINE_ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes
let lastOfflineAlertTimestamp = 0;

/**
 * Checks the database for completed, failed, or stale jobs and acts on them.
 */
async function pollForJobUpdates() {
    try {
        // 1. Handle COMPLETED and FAILED jobs
        // This function retrieves jobs that are 'completed' or 'failed' but haven't been sent to the user yet.
        const actionableJobs = await dbManager.getActionableJobs();
        
        for (const job of actionableJobs) {
            const userLang = job.lang || 'en'; 

            if (job.status === 'completed') {
                console.log(`[Poller] Processing completed job ${job.job_id} for user ${job.user_psid}`);
                
                // Construct delivery message
                const deliveryMessage = lang.getText('delivery_success', userLang) + 
                                       `\n\n${job.result_message}`;
                
                await sendText(job.user_psid, deliveryMessage);
                
                // Update status to 'delivered' so we don't send it again in the next loop
                await dbManager.updateJobStatus(job.job_id, 'delivered', 'Delivered via Poller');
            } 
            else if (job.status === 'failed') {
                console.log(`[Poller] Processing failed job ${job.job_id} for user ${job.user_psid}`);
                
                // Notify User
                await sendText(job.user_psid, lang.getText('delivery_failed_user', userLang));
                
                // Notify Admin
                const adminMessage = `
❌ AUTOMATION FAILED for Job ID: ${job.job_id}
User PSID: ${job.user_psid}
Please check the worker logs and assist the user manually.

Error Details:
${job.result_message}
                `;
                await sendText(ADMIN_ID, adminMessage);
                
                // Update status to 'failed_notified' so we don't spam the admin/user
                await dbManager.updateJobStatus(job.job_id, 'failed_notified', job.result_message);
            }
        }

        // 2. Check for OFFLINE WORKER (Stale Jobs)
        const now = Date.now();
        if (now - lastOfflineAlertTimestamp > OFFLINE_ALERT_COOLDOWN) {
            // Check for jobs stuck in 'pending' for more than 20 minutes
            const staleJobs = await dbManager.getStalePendingJobs(20);
            
            if (staleJobs && staleJobs.length > 0) {
                console.warn(`[Poller] Worker appears to be offline. ${staleJobs.length} jobs are stale.`);
                await sendText(ADMIN_ID, `⚠️ Worker Alert: The automation script may be offline. ${staleJobs.length} job(s) have been pending for over 20 minutes.`);
                lastOfflineAlertTimestamp = now;
            }
        }

    } catch (error) {
        console.error("[Poller] Error in job polling loop:", error.message);
    }
}

/**
 * Starts the background polling service.
 */
function start() {
    // Run once immediately on start
    pollForJobUpdates();
    
    // Then run on interval
    setInterval(pollForJobUpdates, POLLING_INTERVAL);
    console.log(`✅ Job poller started. Checking every ${POLLING_INTERVAL / 1000} seconds.`);
}

// Export the start function so index.js can call it
module.exports = {
    start
};
