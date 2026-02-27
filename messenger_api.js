// messenger_api.js
const axios = require('axios');
const secrets = require('./secrets.js');

const { PAGE_ACCESS_TOKEN } = secrets;

async function sendText(psid, text) {
    const messageData = { recipient: { id: psid }, message: { text: text }, messaging_type: "RESPONSE" };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending text message:", error.response?.data || error.message);
    }
}

async function sendQuickReplies(psid, text, replies) {
    const messageData = {
        recipient: { id: psid },
        messaging_type: "RESPONSE",
        message: {
            text: text,
            quick_replies: replies.map(reply => ({
                content_type: "text",
                title: reply.title,
                payload: reply.payload
            }))
        }
    };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    } catch (error) {
        console.error("Error sending quick replies:", error.response?.data || error.message);
    }
}

async function sendImage(psid, imageUrl) {
    const messageData = {
        recipient: { id: psid },
        message: { attachment: { type: "image", payload: { url: imageUrl, is_reusable: false } } },
        messaging_type: "RESPONSE"
    };
    try {
        await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, messageData);
    }
    catch (error) {
        console.error("Error sending image message:", error.response?.data || error.message);
    }
}

const userProfileCache = new Map();
async function getUserProfile(psid) {
    if (userProfileCache.has(psid)) {
        return userProfileCache.get(psid);
    }
    try {
        const url = `https://graph.facebook.com/v19.0/${psid}?fields=first_name,last_name&access_token=${PAGE_ACCESS_TOKEN}`;
        const response = await axios.get(url);
        if (response.data) {
            const fullName = `${response.data.first_name} ${response.data.last_name}`;
            userProfileCache.set(psid, fullName);
            return fullName;
        }
    } catch (error) {
        console.error(`Failed to fetch user profile for ${psid}:`, error.response?.data || error.message);
        return psid;
    }
    return psid;
}

module.exports = {
    sendText,
    sendImage,
    getUserProfile,
    sendQuickReplies
}; 
 
