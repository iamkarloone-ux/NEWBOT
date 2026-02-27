// user_handler/menu_handler.js
const db = require('../database');
const messengerApi = require('../messenger_api.js');
const lang = require('../language_manager');

// CORRECTED: The function no longer needs sendQuickReplies passed to it.
async function showUserMenu(sender_psid, userLang = 'en') {
    const adminInfo = await db.getAdminInfo();
    let initialMessage = adminInfo?.is_online ? lang.getText('admin_online', userLang) : lang.getText('admin_offline', userLang);
    await messengerApi.sendText(sender_psid, initialMessage);

    const menuText = `${lang.getText('welcome_message', userLang)}\n\n${lang.getText('menu_option_1', userLang)}\n${lang.getText('menu_option_2', userLang)}\n${lang.getText('menu_option_3', userLang)}\n${lang.getText('menu_option_4', userLang)}\n${lang.getText('menu_option_5', userLang)}\n${lang.getText('menu_option_6', userLang)}\n${lang.getText('menu_option_7', userLang)}\n\n${lang.getText('menu_suffix', userLang)}`;
    
    const replies = [
        { title: lang.getText('menu_option_1_button', userLang), payload: "1" },
        { title: lang.getText('menu_option_2_button', userLang), payload: "2" },
        { title: lang.getText('menu_option_3_button', userLang), payload: "3" },
        { title: lang.getText('menu_option_4_button', userLang), payload: "4" },
        { title: lang.getText('menu_option_5_button', userLang), payload: "5" },
        { title: lang.getText('menu_option_6_button', userLang), payload: "6" },
        { title: lang.getText('menu_option_7_button', userLang), payload: "7" },
    ];
    
    // CORRECTED: This now uses the imported messengerApi, just like sendText does.
    await messengerApi.sendQuickReplies(sender_psid, menuText, replies);
}

module.exports = { showUserMenu };
