// user_handler/custom_mod_flow.js (COMPLETE & FINAL VERSION)
const db = require('../database');
const stateManager = require('../state_manager');
const messengerApi = require('../messenger_api');
const lang = require('../language_manager');

/**
 * Step 1: Prompt the user to choose between Money or Gold.
 */
async function promptForCustomMod(sender_psid, userLang = 'en') {
    const message = lang.getText('custom_mod_prompt_choice', userLang);
    const replies = [
        { title: "💰 Money", payload: "custom_money" },
        { title: "✨ Gold", payload: "custom_gold" },
        { title: "⬅️ Back to Menu", payload: "menu" }
    ];
    await messengerApi.sendQuickReplies(sender_psid, message, replies);
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_type', { lang: userLang });
}

/**
 * Step 2: User chose a type, now prompt for the amount.
 */
async function handleCustomModType(sender_psid, payload, userLang = 'en') {
    let prompt = '';
    const orderType = payload === 'custom_money' ? 'Money' : 'Gold';

    if (orderType === 'Money') {
        prompt = lang.getText('custom_mod_prompt_money', userLang);
    } else {
        prompt = lang.getText('custom_mod_prompt_gold', userLang);
    }
    
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    await messengerApi.sendQuickReplies(sender_psid, prompt, replies);
    stateManager.setUserState(sender_psid, 'awaiting_custom_mod_amount', { orderType, lang: userLang });
}

/**
 * Step 3: User entered an amount. Validate it, calculate price, and ask for payment.
 */
async function handleCustomModAmount(sender_psid, text, userLang = 'en') {
    const state = stateManager.getUserState(sender_psid);
    const orderType = state?.orderType;
    const orderAmount = text.trim();
    let price = 0;
    let errorMsg = '';

    // Pricing Logic
    if (orderType === 'Money') {
        const amountMil = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (isNaN(amountMil) || amountMil < 5 || amountMil > 30) {
            errorMsg = lang.getText('custom_mod_invalid_money', userLang);
        } else if (amountMil >= 5 && amountMil <= 10) {
            price = 150;
        } else if (amountMil > 10 && amountMil <= 30) {
            price = 200;
        }
    } else { // Gold logic
        const amountK = parseFloat(orderAmount.replace(/[^0-9.]/g, ''));
        if (isNaN(amountK) || amountK < 1 || amountK > 6) {
            errorMsg = lang.getText('custom_mod_invalid_gold', userLang);
        } else {
            price = 150;
        }
    }
    
    const replies = [{ title: "⬅️ Back to Menu", payload: "menu" }];
    if (price === 0 || errorMsg) {
        await messengerApi.sendQuickReplies(sender_psid, errorMsg || 'Error processing amount.', replies);
        return;
    }
    
    const adminInfo = await db.getAdminInfo();
    const gcashNumber = adminInfo?.gcash_number || "09123963204";
    const paymentMsg = lang.getText('custom_mod_prompt_payment', userLang)
        .replace('{orderAmount}', orderAmount)
        .replace('{orderType}', orderType)
        .replace('{price}', price)
        .replace('{gcashNumber}', gcashNumber);
        
    await messengerApi.sendQuickReplies(sender_psid, paymentMsg, replies);
    stateManager.setUserState(sender_psid, 'awaiting_receipt_for_custom_mod', { 
        orderType, 
        orderAmount, 
        price, 
        lang: userLang 
    });
}

/**
 * Step 4: Handle the receipt analysis for the custom mod and notify Admin.
 */
async function handleCustomModReceipt(sender_psid, analysis, ADMIN_ID, imageUrl, userLang = 'en') {
    // Get pre-collected order details from state
    const state = stateManager.getUserState(sender_psid);
    const orderType = state?.orderType;
    const orderAmount = state?.orderAmount;
    const expectedPrice = state?.price;

    // Extract info from AI
    const amountStr = (analysis.extracted_info?.amount || '').replace(/[^0-9.]/g, '');
    const paidAmount = parseFloat(amountStr);
    const refNumber = (analysis.extracted_info?.reference_number || '').replace(/\s/g, '');
    
    let userName = 'A User';
    try {
        userName = await messengerApi.getUserProfile(sender_psid);
    } catch (e) { console.error("Profile error:", e.message); }
    
    // Check if AI read the receipt correctly
    if (isNaN(paidAmount) || !refNumber || !/^\d{13}$/.test(refNumber)) {
        await messengerApi.sendText(sender_psid, lang.getText('custom_mod_receipt_fail', userLang));
        
        const adminNotification = `⚠️ CUSTOM MOD - AI FAILURE ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nRef: ${refNumber}\nPlease check receipt manually below:`;
        await messengerApi.sendText(ADMIN_ID, adminNotification);
        await messengerApi.sendImage(ADMIN_ID, imageUrl);

    } else if (Math.abs(paidAmount - expectedPrice) > 0.01) {
        // Amount paid does not match the price we calculated
        const mismatchMsg = lang.getText('custom_mod_mismatch', userLang).replace('{amount}', paidAmount).replace('{price}', expectedPrice);
        await messengerApi.sendText(sender_psid, mismatchMsg);
        
        const adminNotification = `⚠️ CUSTOM MOD - PRICE MISMATCH ⚠️\nUser: ${userName}\nOrder: ${orderAmount} ${orderType}\nExpected: ${expectedPrice} PHP\nPaid: ${paidAmount} PHP\nRef: ${refNumber}`;
        await messengerApi.sendText(ADMIN_ID, adminNotification);
        await messengerApi.sendImage(ADMIN_ID, imageUrl);

    } else {
        // Success: Paid amount is correct
        await messengerApi.sendText(sender_psid, lang.getText('custom_mod_success', userLang));
        
        const adminNotification = `✅ NEW CUSTOM MOD ORDER!\nUser: ${userName} (${sender_psid})\nOrder: *${orderAmount} of ${orderType}*\nPrice: ${expectedPrice} PHP\nRef No: ${refNumber}\nReceipt below:`;
        await messengerApi.sendText(ADMIN_ID, adminNotification);
        await messengerApi.sendImage(ADMIN_ID, imageUrl);
    }

    // Reset user state to main menu
    stateManager.clearUserState(sender_psid);
    stateManager.setUserState(sender_psid, 'language_set', { lang: userLang });
}

module.exports = {
    promptForCustomMod,
    handleCustomModType,
    handleCustomModAmount,
    handleCustomModReceipt
}; 
