// user_handler/account_services.js (FULLY AUTOMATED INSTANT REPLACEMENT VERSION)
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');
const { ADMIN_ID } = require('../secrets');
const carxApi = require('../carx_api'); // Direct API Engine

/**
 * Password generator for the automated replacement accounts.
 */
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

// --- Check Claims ---

/**
 * Prompts the user to enter their reference number to check remaining claims.
 */
async function promptForCheckClaims(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_check', { lang: userLang });
}

/**
 * Processes the claim check and informs the user of their remaining replacements.
 */
async function processCheckClaims(sender_psid, refNumber, userLang = 'en') {
    let resultMsg = '';
    const trimmedRef = refNumber.trim();

    if (!/^\d{13}$/.test(trimmedRef)) {
        resultMsg = lang.getText('claims_check_invalid_format', userLang);
    } else {
        const ref = await db.getReference(trimmedRef);
        if (!ref) {
            resultMsg = lang.getText('claims_check_not_found', userLang);
        } else {
            const remaining = ref.claims_max - ref.claims_used;
            const claimsText = remaining === 1 ? '1 replacement account' : `${remaining} replacement accounts`;
            resultMsg = lang.getText('claims_check_result', userLang)
                .replace('{claimsText}', claimsText)
                .replace('{modId}', ref.mod_id)
                .replace('{modName}', ref.mod_name);
        }
    }
    
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, resultMsg, replies);
}


// --- Replacement Request (FULLY AUTOMATED INSTANT REPLACEMENT) ---

/**
 * Prompts the user for a reference number to start a replacement request.
 */
async function promptForReplacement(sender_psid, userLang = 'en') {
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_prompt', userLang), replies);
    stateManager.setUserState(sender_psid, 'awaiting_ref_for_replacement', { lang: userLang });
}

/**
 * Validates the request and instantly creates + injects a replacement account via API.
 */
async function processReplacementRequest(sender_psid, refNumber, userLang = 'en') {
    const trimmedRef = refNumber.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];

    // 1. Validation Checks
    if (!/^\d{13}$/.test(trimmedRef)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_invalid_format', userLang), replies);
        return;
    }

    const ref = await db.getReference(trimmedRef);

    if (!ref) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('claims_check_not_found', userLang), replies);
        return;
    }

    // Check for 24-hour cooldown
    if (ref.last_replacement_timestamp) {
        const lastReplacementTime = new Date(ref.last_replacement_timestamp).getTime();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        if (Date.now() - lastReplacementTime < twentyFourHours) {
            await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_limit_reached', userLang), replies);
            return;
        }
    }

    // Check if claims are exhausted
    if (ref.claims_used >= ref.claims_max) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('replace_no_claims', userLang), replies);
        return;
    }

    // 2. Direct API Replacement Generation
    try {
        await messengerApi.sendText(sender_psid, "🚀 Connecting to CarX Servers... Creating your replacement account instantly.");

        const mod = await db.getModById(ref.mod_id);
        const template = await db.getTemplateByName(mod.template_name || "Set1");
        if (!template) throw new Error("No profile template found in database.");

        const password = generatePassword();
        const placeholderEmail = `acct-${sender_psid}-${Date.now()}@replacement.bot`;

        // Direct API Creation & Injection (The Python cloner logic)
        const result = await carxApi.createAndInject(placeholderEmail, password, template);

        if (result) {
            // Increment used claims on success
            await db.useClaim(ref.ref_number);

            const deliveryMessage = lang.getText('delivery_success', userLang) + 
                                   `\n\n📧 Username: \`${placeholderEmail}\`\n🔐 Password: \`${password}\`\n🆔 CarX ID: \`${result.carxId}\`\n\nEnjoy the game! 💙`;
            
            await messengerApi.sendText(sender_psid, deliveryMessage);
            
            let userName = 'A User';
            try { userName = await messengerApi.getUserProfile(sender_psid); } catch(err) {}
            await messengerApi.sendText(ADMIN_ID, `🤖 INSTANT REPLACEMENT: Generated account for ${userName}\nMod: ${ref.mod_name}\nRef: ${ref.ref_number}`);
        }

    } catch (e) {
        console.error("Error during automated replacement generation:", e);
        await messengerApi.sendText(sender_psid, "❌ Replacement Failed: " + e.message);
        await messengerApi.sendText(ADMIN_ID, `🚨 AUTOMATION FAIL (REPLACEMENT): ${sender_psid} tried to get replacement but API threw: ${e.message}`);
    }

    // 3. Reset State
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

module.exports = {
    promptForCheckClaims,
    processCheckClaims,
    promptForReplacement,
    processReplacementRequest
};
