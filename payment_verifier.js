// payment_verifier.js (Updated for Render Environment Variables)
const axios = require('axios');
const sharp = require('sharp');

// Get API key from environment variable (set in Render dashboard)
const API_KEY = process.env.GEMINI_API_KEY;

// Validate API key exists
if (!API_KEY) {
    console.error("❌ CRITICAL: GEMINI_API_KEY environment variable is not set!");
    console.error("Please add GEMINI_API_KEY to your Render environment variables.");
}

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`;

const ANALYSIS_PROMPT = `
ACT AS A GCASH RECEIPT SCANNER.
1. Find the 13-digit Reference Number (look for 'Ref No').
2. Find the total Amount Sent in PHP.

YOU MUST REPLY ONLY WITH A JSON OBJECT. NO TEXT.
{
    "extracted_info": {
        "reference_number": "13DIGITS_ONLY_NO_SPACES",
        "amount": "NUMBER_ONLY"
    },
    "verification_status": "APPROVED",
    "reasoning": "OCR result"
}`;

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

function cleanAndParseJSON(text) {
    try {
        // Remove markdown code blocks if present
        let cleanText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');

        const jsonMatch = cleanText.match(/({[\s\S]*})/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.extracted_info?.reference_number) {
            // Forcefully remove all non-digit characters
            parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\D/g, "");
        }
        return parsed;
    } catch (e) { 
        console.error("JSON parsing error:", e.message);
        return null; 
    }
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    // Check if API key is configured
    if (!API_KEY) {
        console.error("Cannot analyze receipt: GEMINI_API_KEY not configured");
        return { 
            extracted_info: { reference_number: "API_KEY_MISSING", amount: "0" }, 
            verification_status: "REJECTED",
            reasoning: "API key not configured"
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
            temperature: 0.1,  // Slightly higher for flexibility
            response_mime_type: "application/json"
        }
    };

    try {
        console.log("📤 Sending request to Gemini API...");

        const response = await axios.post(API_URL, payload, { 
            headers: { "Content-Type": "application/json" }, 
            timeout: 35000 
        });

        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

        console.log("📥 Raw AI Response:", aiText);

        if (!aiText) {
            console.error("Empty response from Gemini API");
            return { 
                extracted_info: { reference_number: "Not Found" }, 
                verification_status: "REJECTED",
                reasoning: "Empty API response"
            };
        }

        const parsed = cleanAndParseJSON(aiText);

        if (!parsed) {
            console.error("Failed to parse AI response as JSON");
            return { 
                extracted_info: { reference_number: "Parse Error" }, 
                verification_status: "REJECTED",
                reasoning: "JSON parse failed"
            };
        }

        return parsed;

    } catch (error) {
        console.error("❌ Gemini API Error:", error.response?.data || error.message);
        return { 
            extracted_info: { reference_number: "Not Found" }, 
            verification_status: "REJECTED",
            reasoning: `API Error: ${error.message}`
        };
    }
}

module.exports = { encodeImage, analyzeReceiptWithFallback };    try {
        const jsonMatch = text.match(/({[\s\S]*})/);
        if (!jsonMatch) return null;
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.extracted_info?.reference_number) {
            // Forcefully remove spaces: "123 456..." -> "123456..."
            parsed.extracted_info.reference_number = String(parsed.extracted_info.reference_number).replace(/\D/g, "");
        }
        return parsed;
    } catch (e) { return null; }
}

async function analyzeReceiptWithFallback(imageUrl, image_b64) {
    const payload = {
        contents: [{ parts: [{ text: ANALYSIS_PROMPT }, { inline_data: { mime_type: "image/jpeg", data: image_b64 } }] }],
        generationConfig: { temperature: 0, response_mime_type: "application/json" }
    };
    try {
        const response = await axios.post(API_URL, payload, { headers: { "Content-Type": "application/json" }, timeout: 35000 });
        const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return aiText ? cleanAndParseJSON(aiText) : null;
    } catch (error) {
        return { extracted_info: { reference_number: "Not Found" }, verification_status: "REJECTED" };
    }
}
module.exports = { encodeImage, analyzeReceiptWithFallback };
