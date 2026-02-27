// language_manager.js
const fs = require('fs');
const path = require('path');

// Load all language files from the 'locales' directory into memory
const locales = {
    en: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/en.json'), 'utf8')),
    tl: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales/tl.json'), 'utf8'))
};

/**
 * Gets a text string in the specified language.
 * @param {string} key - The key of the text to retrieve (e.g., 'welcome_message').
 * @param {string} lang - The language code ('en' or 'tl'). Defaults to 'en'.
 * @returns {string} The translated text. If a key is not found, it returns the key itself.
 */
function getText(key, lang = 'en') {
    // Default to English if the specified language or key doesn't exist
    return locales[lang]?.[key] || locales['en']?.[key] || key;
}

module.exports = { getText };
