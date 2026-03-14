// payment_verifier.js
const axios = require('axios');
const sharp = require('sharp');

const ANALYSIS_PROMPT = `ACT AS A GCASH RECEIPT SCANNER. 
1. Find the 13-digit Reference Number (look for 'Ref No'). 
2. Find the total Amount Sent in PHP. 
YOU MUST REPLY ONLY WITH A JSON OBJECT: 
{"extracted_info": {"reference_number": "13DIGITS", "amount": "NUMBER"}, "verification_status": "APPROVED"}`;

/**
 * Pre-processes the image for local storage (optional but kept for your existing flow)
 */
async function encodeImage(imageBuffer) {
    try {
        const processed = await sharp(imageBuffer)
            .resize({ width: 1200 })
            .sharpen()
            .toFormat('jpeg', { quality: 90 })
            .toBuffer();
        return processed.toString('base64');
    } catch (error) {
        console.error("Image encoding error:", error.message);
        return null;
    }
}

/**
 * NEW: Calls the external API (smfahim.xyz)
 */
async function analyzeReceiptWithExternalAPI(imageUrl) {
    try {
        // Construct the URL with encoded parameters
        const encodedPrompt = encodeURIComponent(ANALYSIS_PROMPT);
        const encodedImgUrl = encodeURIComponent(imageUrl);
        const targetUrl = `https://smfahim.xyz/ai/gemini/v2?prompt=${encodedPrompt}&imgUrl=${encodedImgUrl}`;

        console.log(`[API] Calling External Scanner...`);
        
        const response = await axios.get(targetUrl, { timeout: 30000 });
        
        // The API returns the AI text directly or in a specific field. 
        // Based on common patterns for this API:
        const aiText = response.data.content || response.data.result || response.data;

        return cleanAndParseJSON(aiText);
    } catch (error) {
        console.error("❌ External API Error:", error.message);
        return null;
    }
}

/**
 * Cleans the AI response to ensure valid JSON
 */
function cleanAndParseJSON(text) {
    try {
        if (typeof text !== 'string') text = JSON.stringify(text);
        
        // Remove markdown code blocks if present
        let cleanText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const jsonMatch = cleanText.match(/({[\s\S]*})/);
        
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.extracted_info?.reference_number) {
            parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\D/g, "");
        }
        if (parsed.extracted_info?.amount) {
            parsed.extracted_info.amount = String(parsed.extracted_info.amount).replace(/,/g, "");
        }

        return parsed;
    } catch (e) {
        console.error("JSON parsing error:", e.message);
        return null;
    }
}

/**
 * Main function used by index.js
 * It tries the new API first, and you can keep your Gemini logic as a backup
 */
async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    // 1. Try the new External API first
    const result = await analyzeReceiptWithExternalAPI(imageUrl);
    
    if (result && result.extracted_info?.reference_number !== "Not Found") {
        return result;
    }

    // 2. Fallback to official Gemini if you have the API Key set (optional)
    console.log("External API failed or found nothing. Trying fallback...");
    // ... (You can keep your old Gemini axios.post code here if you want a backup) ...
    
    return { 
        extracted_info: { reference_number: "Not Found" }, 
        verification_status: "REJECTED",
        reasoning: "Could not detect receipt details."
    };
}

module.exports = { encodeImage, analyzeReceiptWithFallback };
