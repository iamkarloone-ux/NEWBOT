// error_handler.js
const { sendText } = require('./messenger_api.js');
const lang = require('./language_manager.js');
const { ADMIN_ID } = require('./secrets.js');
const stateManager = require('./state_manager.js');

/**
 * A centralized function to handle unexpected errors, log them for the admin,
 * and provide a user-friendly message.
 * @param {Error} error - The error object caught.
 * @param {string} sender_psid - The PSID of the user who experienced the error.
 * @param {string} userLang - The language of the user ('en' or 'tl').
 * @param {string} context - A brief description of where the error occurred (e.g., 'Replacement Request').
 */
async function handleUserError(error, sender_psid, userLang = 'en', context = 'an unknown process') {
    console.error(`[ERROR] Context: ${context} | User: ${sender_psid} | Message: ${error.message}`);
    console.error(error.stack); // Log the full stack trace for debugging

    // Notify the admin with detailed information
    const adminMessage = `
        ⚠️ An unexpected error occurred for a user.
        ---
        Context: ${context}
        User PSID: ${sender_psid}
        Error: ${error.message}
        ---
        Please check the logs for the full stack trace.
    `;
    try {
        await sendText(ADMIN_ID, adminMessage);
    } catch (adminSendError) {
        console.error("CRITICAL: Failed to send error notification to admin.", adminSendError);
    }

    // Send a generic, user-friendly message to the user
    try {
        await sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
    } catch (userSendError) {
        console.error(`CRITICAL: Failed to send error message to user ${sender_psid}.`, userSendError);
    }

    // Clear the user's state to prevent them from being stuck
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

module.exports = { handleUserError }; 
 
