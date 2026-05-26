// carx_api.js
const axios = require('axios');
const zlib = require('zlib');
const crypto = require('crypto');

const BASE_AUTH = "https://carx-id-prod.carx-online.com/api/auth";
const BASE_SYNC = "https://street-prod.carx-online.com/str/v1/client";

const clonerUtils = {
    // Decrypts the CarX profile string (Gzip + Base64)
    decrypt: (str) => {
        try {
            const decoded = Buffer.from(str.slice(4), 'base64');
            const decompressed = zlib.gunzipSync(decoded.slice(1));
            return JSON.parse(decompressed.toString('utf-8'));
        } catch (e) {
            console.error("Decryption failed:", e.message);
            return null;
        }
    },
    // Encrypts JSON into CarX format (Strict, No spaces)
    encrypt: (obj) => {
        try {
            const jsonStr = JSON.stringify(obj);
            const gzipped = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
            const final = Buffer.concat([Buffer.from([0x00]), gzipped]);
            return "l84l" + final.toString('base64');
        } catch (e) {
            console.error("Encryption failed:", e.message);
            return null;
        }
    },
    // Removes session-specific keys to prevent the "Initializing User" hang
    sanitize: (prof) => {
        const fatalKeys = ["current_car_id", "last_apartment_id", "tutorial_state", "location_id"];
        fatalKeys.forEach(k => { if(prof[k]) delete prof[k]; });
        return prof;
    }
};

/**
 * Automates the full process: Register -> Verify -> Login -> Heartbeat -> Profile Injection
 */
async function createAndInject(email, password, profileTemplate) {
    const devId = crypto.randomUUID().replace(/-/g, '');
    // Generate a random CarX User ID
    const carxId = `User${Math.floor(Math.random() * 9000000) + 1000000}`;
    
    const api = axios.create({
        headers: { 
            "User-Agent": "UnityPlayer/6000.0.64f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)", 
            "X-Project": "STREET", 
            "Content-Type": "application/json" 
        }
    });

    try {
        // 1. Register & Verify
        await api.post(`${BASE_AUTH}/register`, { project: "STREET", username: email, password, deviceId: devId, deviceUniqueId: devId });
        await api.post(`${BASE_AUTH}/verify`, { code: "g4a369" });

        // 2. Login
        const login = await api.post(`${BASE_AUTH}/login`, { project: "STREET", username: email, password, deviceId: devId, deviceUniqueId: devId });
        const token = login.data.d?.token || login.data.token;
        const h = { "Authorization": `Bearer ${token}`, "x-token": token, "X-CarX-Id": carxId, "X-Device-Id": devId };

        // 3. Heartbeat (Verify session)
        await api.post(`${BASE_AUTH}/verify`, { code: "g4a369" }, { headers: h });

        // 4. Inject Profile Data
        const sanitized = clonerUtils.sanitize(profileTemplate);
        const payload = {
            carxId: carxId,
            compressed_data: clonerUtils.encrypt(sanitized),
            lastSyncTime: Math.floor(Date.now() / 1000),
            clientVersion: "1.18.0",
            dataVersion: 70
        };

        const res = await api.post(`${BASE_SYNC}/profiles`, payload, { headers: h });
        
        if (res.status === 200) {
            return { carxId, email, password };
        }
        return false;
    } catch (e) {
        console.error("Direct API Injection Error:", e.response?.data || e.message);
        throw new Error(e.response?.data?.m || "Server connection failed during injection.");
    }
}

/**
 * Downloads a profile from an existing account
 */
async function fetchExistingProfile(email, password, devId, carxId) {
    const api = axios.create({
        headers: { "User-Agent": "UnityPlayer/6000.0.64f1", "X-Project": "STREET" }
    });

    const login = await api.post(`${BASE_AUTH}/login`, { project: "STREET", username: email, password, deviceId: devId, deviceUniqueId: devId });
    const token = login.data.d?.token || login.data.token;
    const h = { "Authorization": `Bearer ${token}`, "x-token": token, "X-CarX-Id": carxId, "X-Device-Id": devId };
    
    await api.post(`${BASE_AUTH}/verify`, { code: "g4a369" }, { headers: h });
    const res = await api.get(`${BASE_SYNC}/profiles`, { headers: h });
    
    // Recursive search for compressed_data
    const findData = (obj) => {
        if (obj && typeof obj === 'object') {
            if (obj.compressed_data) return obj.compressed_data;
            for (let key in obj) {
                const res = findData(obj[key]);
                if (res) return res;
            }
        }
        return null;
    };

    const compressed = findData(res.data);
    return clonerUtils.decrypt(compressed);
}

module.exports = { createAndInject, fetchExistingProfile, clonerUtils };
