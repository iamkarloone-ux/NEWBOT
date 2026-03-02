// payment_verifier.js (Optimized for Render & Production)
const axios = require('axios');
const sharp = require('sharp');

// 1. Get API key from environment variable
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("❌ CRITICAL: GEMINI_API_KEY environment variable is not set!");
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

const ANALYSIS_PROMPT = `
ACT AS A GCASH RECEIPT SCANNER.
1. Find the 13-digit Reference Number (look for 'Ref No').
2. Find the total Amount Sent in PHP.

YOU MUST REPLY ONLY WITH A JSON OBJECT. NO TEXT.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY_NO_SPACES",
        "amount": "NUMBER_ONLY_NO_COMMAS"
    },
    "verification_status": "APPROVED",
    "reasoning": "OCR result"
}`;

/**
 * Pre-processes the image to improve OCR accuracy
 */
async function encodeImage(imageBuffer) {
    try {
        const processed = await sharp(imageBuffer)
            .resize({ width: 1200 }) // Standardize size
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
 * Cleans the AI response to ensure valid JSON and formatting
 */
function cleanAndParseJSON(text) {
    try {
        // Remove markdown formatting if the AI accidentally includes it
        let cleanText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

        const jsonMatch = cleanText.match(/({[\s\S]*})/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);

        // Clean Reference Number (Digits only)
        if (parsed.extracted_info?.reference_number) {
            parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\D/g, "");
        }

        // Clean Amount (Remove commas, ensure it's a string/number)
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
 * Sends image to Gemini for analysis
 */
async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    if (!API_KEY) {
        return { 
            extracted_info: { reference_number: "ERROR", amount: "0" }, 
            verification_status: "REJECTED",
            reasoning: "API key missing in environment variables"
        };
    }

    const payload = {
        contents: [{ 
            parts: [
                { text: ANALYSIS_PROMPT }, 
                { inline_data: { mime_type: "image/jpeg", data: image_b64 } }
            ] 
        }],
        generationConfig: { 
            temperature: 0.1, // Keep it precise
            response_mime_type: "application/json"
        }
    };

    try {
        const response = await axios.post(API_URL, payload, { 
            headers: { "Content-Type": "application/json" }, 
            timeout: 30000 
        });

        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!aiText) {
            throw new Error("Empty response from Gemini");
        }

        const parsed = cleanAndParseJSON(aiText);
        return parsed || { verification_status: "REJECTED", reasoning: "Could not parse receipt data" };

    } catch (error) {
        console.error("❌ Gemini API Error:", error.response?.data || error.message);
        return { 
            extracted_info: { reference_number: "Not Found" }, 
            verification_status: "REJECTED",
            reasoning: `AI Error: ${error.message}`
        };
    }
}

module.exports = { encodeImage, analyzeReceiptWithFallback };
