// user_handler/purchase_flow.js (COMPLETE & FINAL VERSION)
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');
const manualEntry = require('./manual_entry_flow'); // Critical for AI fallback

/**
 * Generates a random password for automated account creation.
 * This is used when a user buys a mod and needs an account.
 */
function generatePassword(length = 10) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let retVal = "";
    for (let i = 0, n = charset.length; i < length; ++i) {
        retVal += charset.charAt(Math.floor(Math.random() * n));
    }
    return retVal;
}

/**
 * Displays available mods to the user.
 * Triggered when user types "1" from the main menu.
 */
async function handleViewMods(sender_psid, userLang = 'en') {
    const mods = await db.getMods();
    if (!mods || mods.length === 0) {
        const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('mods_none_available', userLang), replies);
        return;
    }
    let response = `${lang.getText('mods_header', userLang)}\n`;
    mods.forEach(mod => {
        const claimsText = mod.default_claims_max === 1 ? '1 Replacement' : `${mod.default_claims_max} Replacements`;
        response += `\n📦 Type ${mod.id}:\n${mod.description || 'N/A'}\n💰 Price: ${mod.price} PHP\n🔁 FreeAcc: ${claimsText}\n🖼️ Image: ${mod.image_url || 'N/A'}\n`;
    });
    
    const finalMessage = response + `\n${lang.getText('mods_purchase_prompt', userLang)}`;
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    
    await messengerApi.sendQuickReplies(sender_psid, finalMessage, replies);
    stateManager.setUserState(sender_psid, 'awaiting_want_mod', { lang: userLang });
}

/**
 * Handles the selection of a specific mod.
 * Asks the user for their email address.
 */
async function handleWantMod(sender_psid, text, userLang = 'en') {
    const modId = parseInt(text.trim());
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    if (isNaN(modId)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_format', userLang), replies);
        return;
    }
    const mod = await db.getModById(modId);
    if (!mod) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_mod', userLang), replies);
        return;
    }
    const promptEmailMsg = lang.getText('purchase_prompt_email', userLang).replace('{modId}', mod.id).replace('{modName}', mod.name);
    await messengerApi.sendQuickReplies(sender_psid, promptEmailMsg, replies);
    stateManager.setUserState(sender_psid, 'awaiting_email_for_purchase', { modId: mod.id, lang: userLang });
}

/**
 * Validates the email and prompts for payment.
 * Provides the Admin GCash number.
 */
async function handleEmailForPurchase(sender_psid, text, userLang = 'en') {
    const state = stateManager.getUserState(sender_psid);
    const modId = state?.modId;
    const email = text.trim();
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    
    if (!/\S+@\S+\.\S+/.test(email)) {
        await messengerApi.sendQuickReplies(sender_psid, lang.getText('purchase_invalid_email', userLang), replies);
        return;
    }
    
    const mod = await db.getModById(modId);
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";
    
    const paymentMessage = lang.getText('purchase_prompt_payment', userLang)
        .replace('{price}', mod.price)
        .replace('{gcashNumber}', gcashNumber);
        
    await messengerApi.sendQuickReplies(sender_psid, paymentMessage, replies);
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_purchase', { modId, email, lang: userLang });
}

/**
 * Processes the AI analysis of the receipt.
 * Automatically triggers manual entry if the AI fails.
 */
async function handleReceiptAnalysis(sender_psid, analysis, ADMIN_ID, userLang = 'en') {
    // FIX: Retrieve state correctly using modern spreading to avoid data loss
    const currentState = stateManager.getUserState(sender_psid) || {};
    
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const amount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    
    let userName = 'A User';
    try {
        userName = await messengerApi.getUserProfile(sender_psid);
    } catch (e) {
        console.error("Profile Fetch Failed:", e.message);
    }

    // AI FAILURE CHECK: If data is missing, go to Manual Entry immediately
    if (isNaN(amount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        console.warn(`[AI-SCAN-FAILED] Redirecting user ${sender_psid} to manual entry.`);
        return await manualEntry.startManualEntryFlow(sender_psid, messengerApi.sendText, currentState.imageUrl, userLang);
    }

    const matchingMods = await db.getModsByPrice(amount);
    if (matchingMods.length === 1) {
        const mod = matchingMods[0];
        const confirmationMsg = lang.getText('receipt_confirm_purchase', userLang)
            .replace('{amount}', amount).replace('{modId}', mod.id).replace('{modName}', mod.name);
            
        const replies = [
            { title: lang.getText('confirm_yes', userLang), payload: "confirm_yes" }, 
            { title: lang.getText('confirm_no', userLang), payload: "confirm_no" }
        ];
        
        await messengerApi.sendQuickReplies(sender_psid, confirmationMsg, replies);
        // FIX: Ensuring email and modId are passed to the confirmation state
        stateManager.setUserState(sender_psid, 'awaiting_mod_confirmation', { 
            refNumber, 
            modId: mod.id, 
            modName: mod.name, 
            email: currentState.email, 
            lang: userLang 
        });

    } else if (matchingMods.length > 1) {
        let modList = '';
        matchingMods.forEach(m => { modList += `- Mod ${m.id}: ${m.name}\n`; });
        const clarificationMsg = lang.getText('receipt_clarify_purchase', userLang).replace('{amount}', amount).replace('{modList}', modList);
        await messengerApi.sendText(sender_psid, clarificationMsg);
        
        stateManager.setUserState(sender_psid, 'awaiting_mod_clarification', { 
            refNumber, 
            email: currentState.email, 
            lang: userLang 
        });

    } else {
        await messengerApi.sendText(sender_psid, lang.getText('receipt_no_match', userLang).replace('{amount}', amount));
        await messengerApi.sendText(ADMIN_ID, `User ${userName} paid ${amount} PHP, but no mod matches. Ref: ${refNumber}`);
        stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
    }
}

/**
 * Handles the final 'Yes' confirmation from the user.
 * Creates the automation job for the worker script.
 */
async function handleModConfirmation(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const state = stateManager.getUserState(sender_psid);
    const positiveConfirmation = lang.getText('confirm_yes', userLang).toLowerCase();
    
    if (text.toLowerCase() === 'confirm_yes' || text.toLowerCase() === 'yes' || text.toLowerCase() === positiveConfirmation) {
        try {
            let userName = 'A User';
            try { userName = await messengerApi.getUserProfile(sender_psid); } catch (pErr) {}

            await db.addReference(state.refNumber, sender_psid, state.modId);
            
            const password = generatePassword();
            const safeEmail = state.email || "No Email Provided"; 

            // SUCCESS: Queue the job and notify the admin
            const jobId = await db.createAccountCreationJob(sender_psid, safeEmail, password, state.modId);
            
            const confirmationMessage = lang.getText('automation_started_user', userLang).replace('{modName}', state.modName);
            await messengerApi.sendText(sender_psid, confirmationMessage);
            
            await messengerApi.sendText(ADMIN_ID, `🤖 Automation job (ID: ${jobId}) queued for ${userName}\nMod: ${state.modName}\nRef: ${state.refNumber}`);

        } catch (e) {
            if (e.message === 'Duplicate reference number') {
                await messengerApi.sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
            } else { 
                console.error("Critical Purchase Error:", e);
                await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
            }
        }
    } else {
        await messengerApi.sendText(sender_psid, lang.getText('receipt_transaction_cancelled', userLang));
    }
    
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

/**
 * Handles mod choice clarification if multiple mods have the same price.
 */
async function handleModClarification(sender_psid, text, ADMIN_ID, userLang = 'en') {
    const state = stateManager.getUserState(sender_psid);
    const modId = parseInt(text.trim());
    try {
        const mod = await db.getModById(modId);
        if (isNaN(modId) || !mod) {
            await messengerApi.sendText(sender_psid, lang.getText('manual_entry_invalid_mod', userLang));
            return; 
        }

        let userName = 'A User';
        try { userName = await messengerApi.getUserProfile(sender_psid); } catch (pErr) {}

        await db.addReference(state.refNumber, sender_psid, modId);
        
        const password = generatePassword();
        const safeEmail = state.email || "No Email Provided";

        const jobId = await db.createAccountCreationJob(sender_psid, safeEmail, password, modId);
        
        const confirmationMessage = lang.getText('automation_started_user', userLang).replace('{modName}', mod.name);
        await messengerApi.sendText(sender_psid, confirmationMessage);
        
        await messengerApi.sendText(ADMIN_ID, `🤖 Automation job (ID: ${jobId}) queued for ${userName}\nMod: ${mod.name}\nRef: ${state.refNumber}`);

    } catch (e) {
        if (e.message === 'Duplicate reference number') {
            await messengerApi.sendText(sender_psid, lang.getText('error_duplicate_ref', userLang));
        } else { 
            await messengerApi.sendText(sender_psid, lang.getText('error_unexpected_user', userLang));
        }
    }
    
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

module.exports = {
    handleViewMods,
    handleWantMod,
    handleEmailForPurchase,
    handleReceiptAnalysis,
    handleModConfirmation,
    handleModClarification,
};
