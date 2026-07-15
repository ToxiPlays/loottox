import { basic, standard } from './rates.mjs';
import mediaDictionary from "./media/toc.json" with { type: "json" };
import cryptoModule from 'crypto';

const halfday = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
const hour = 60 * 60 * 1000;

let key = `TXDL_${Date.now() / 2}_${Date.now() % 1.5}_01${Date.now() / 0.2}`;

// rarities: common, uncommon, rare, legendary

const transactions = new Map();

// --- AES-256-GCM helpers ---
// Derives a 32-byte AES key from a UUID by SHA-256 hashing it.
function deriveAesKey(uuid) {
    return cryptoModule.createHash('sha256').update(uuid).digest();
}

// Encrypts plaintext with AES-256-GCM; returns "ivHex:tagHex:ciphertextHex"
function aesEncrypt(plaintext, uuid) {
    const aesKey = deriveAesKey(uuid);
    const iv = cryptoModule.randomBytes(12);
    const cipher = cryptoModule.createCipheriv('aes-256-gcm', aesKey, iv);
    let enc = cipher.update(plaintext, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc}`;
}

// Decrypts a payload produced by aesEncrypt; returns plaintext or null on failure.
function aesDecrypt(payload, uuid) {
    try {
        const parts = payload.split(':');
        if (parts.length !== 3) return null;
        const [ivHex, tagHex, encHex] = parts;
        const aesKey = deriveAesKey(uuid);
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const decipher = cryptoModule.createDecipheriv('aes-256-gcm', aesKey, iv);
        decipher.setAuthTag(tag);
        let dec = decipher.update(encHex, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    } catch {
        return null;
    }
}

// Validates a downloadKey cookie against the transaction it claims to belong to.
// Returns { valid: true, transaction } or { valid: false, message }.
function validateDownloadKey(encryptedKey, transactionId) {
    if (!encryptedKey || !transactionId) {
        return { valid: false, message: 'Missing download key or transaction ID.' };
    }
    const txResult = validateTransactionID(transactionId);
    if (!txResult.valid) return txResult;

    const decrypted = aesDecrypt(encryptedKey, transactionId);
    const ta = transactions.get(transactionId);
    if (decrypted !== ta.downloadKey) {
        return { valid: false, message: 'Download key is invalid or does not match this transaction.' };
    }
    return { valid: true, transaction: ta };
}

function validateRates() {
    for (const [name, table] of [['basic', basic], ['standard', standard]]) {
        const total = Object.values(table).reduce((sum, v) => sum + v, 0);
        if (total !== 100) {
            throw new Error(
                `Rate table "${name}" is invalid: values sum to ${total}%, expected 100%.`
            );
        }
    }
}

function generateTransaction(type, req, res) {
    // type: basic, standard, ultra
    const uuid = crypto.randomUUID();

    const transaction = {};
    transaction.id = uuid;
    transaction.type = type;
    transaction.userAgent = req.get('User-Agent');
    transaction.ip = req.ip;
    transaction.timestamp = new Date().toISOString();
    transaction.expiresAt = new Date(Date.now() + halfday).toISOString();
    transaction.items = [];
    transaction.downloadAttempts = 0;

    // Attach an encrypted download key for non-basic transactions
    if (type !== 'basic') {
        transaction.downloadKey = key; // the plaintext key value
        const encryptedKey = aesEncrypt(key, uuid);
        res.cookie('downloadKey', encryptedKey, { httpOnly: false, maxAge: hour });
    }

    const pools = {};
    for (const song of mediaDictionary) {
        if (!pools[song.rarity]) pools[song.rarity] = [];
        pools[song.rarity].push(song);
    }
    
    for (const rarity in pools) {
        const arr = pools[rarity];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]]; // Fisher-Yates shuffle
        }
    }

    // Pick the rate table for this type (ultra uses standard's table)
    const rateTable = type === 'basic' ? basic : standard;

    const thresholds = [];
    let cumulative = 0;
    for (const [rarity, pct] of Object.entries(rateTable)) {
        cumulative += pct;
        thresholds.push({ rarity, threshold: cumulative });
    }

    function pickRarity(rng) {
        const roll = rng * 100;
        for (const { rarity, threshold } of thresholds) {
            if (roll < threshold) return rarity;
        }
        return thresholds[thresholds.length - 1].rarity;
    }

    function pickFromPool(rarity) {
        const pool = pools[rarity];
        if (!pool || pool.length === 0) {
            // dip into another rarity if this pool's exhausted
            const fallbacks = Object.keys(pools).filter(r => pools[r].length > 0);
            if (fallbacks.length === 0) throw new Error('No songs left in any pool.');
            const fallRarity = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            return pools[fallRarity].pop();
        }
        return pool.pop();
    }

    const TARGET = 5;
    for (let i = 0; i < TARGET; i++) {
        // when ultra, force the 5th pick (index 4) to be legendary
        if (type === 'ultra' && i === TARGET - 1) {
            transaction.items.push(pickFromPool('legendary'));
        } else {
            const rarity = pickRarity(Math.random());
            transaction.items.push(pickFromPool(rarity));
        }
    }
    
    transactions.set(uuid, transaction);
    console.log(transaction);

    return transaction;
}

function validateTransactionID(id) {
    if (!id || typeof id !== 'string') {
        throw new Error('Transaction ID must be a non-empty string.');
    }
    if (!transactions.has(id)) {
        return { valid: false, message: 'Transaction ID not found.' };
    }
    if (new Date(transactions.get(id).expiresAt) < new Date()) {
        return { valid: false, message: 'Transaction ID has expired.' };
    }
    return { valid: true };
}

validateRates();

import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(cookieParser());
const port = 3000;

app.set('trust proxy', 1); 

app.get('/', (req, res) => {
  const transactionId = req.cookies.transactionId;
  if (transactionId) {
    //console.log("transaction id cookie")
    const result = validateTransactionID(transactionId);
    if (result.valid) {
        //console.log("valid transaction id")
        res.sendFile(import.meta.dirname + "/src/transaction.html");
        return true;
    } else {
        //console.log("not valid transaction id")
        res.clearCookie("transactionId");
        res.clearCookie("downloadKey");
    }
  } else {
    //console.log("no transaction id")
  }
  const filePath = path.join(import.meta.dirname, 'src', 'landing.html');
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading file');
        }
        const modifiedContent = data.replace('[BC]', basic.common)
        .replace('[BU]', basic.uncommon)
        .replace('[BR]', basic.rare)
        .replace('[BL]', basic.legendary)
        .replace('[SC]', standard.common)
        .replace('[SU]', standard.uncommon)
        .replace('[SR]', standard.rare)
        .replace('[SL]', standard.legendary);
        res.send(modifiedContent);
    });
});

app.get('/buy/standard', (req, res) => {
    const transactionId = req.cookies.transactionId;
    if (transactionId) {
        res.redirect('/');
    } else {
        res.redirect('https://buy.stripe.com/fZudR96o72qd2ty8Ql4ow00');
    }
});

app.get('/buy/ultra', (req, res) => {
    const transactionId = req.cookies.transactionId;
    if (transactionId) {
        res.redirect('/');
    } else {
        res.redirect('https://buy.stripe.com/aFa28rcMvc0N8RW9Up4ow01');
    }
});

app.get('/api/get-basic-transaction/', (req, res) => {
    function findInMap(map, prop, targetValue) {
        for (const [key, item] of map.entries()) {
            if (item && item[prop] === targetValue) {
                const notExpired = new Date(item.expiresAt) > new Date();
                if (notExpired) return { key, item };
            }
        }
        return null;
    }

    const map_transaction = findInMap(transactions, 'ip', req.ip);
    if (map_transaction) {
        let expiryDate = new Date(map_transaction.item.expiresAt);
        let age = expiryDate - Date.now();
        res.cookie('transactionId', map_transaction.item.id, { httpOnly: false, maxAge: age });
        res.status(200).send("OK");
    } else {
        const nt = generateTransaction("basic", req, res);
        res.cookie('transactionId', nt.id, { httpOnly: false, maxAge: halfday }); 
        res.status(200).send("OK");
    }
});

app.get('/standard_confirm/', (req, res) => {
    const id = req.query.validate;
    if (id) {
        const nt = generateTransaction("standard", req, res);
        res.cookie('transactionId', nt.id, { httpOnly: false, maxAge: halfday }); 
        res.redirect("/");
    } else {
        res.status(403).send("erm...");
    }
});

app.get('/ultra_confirm/', (req, res) => {
    const id = req.query.validate;
    if (id) {
        const nt = generateTransaction("ultra", req, res);
        res.cookie('transactionId', nt.id, { httpOnly: false, maxAge: halfday }); 
        res.redirect("/");
    } else {
        res.status(403).send("erm...");
    }
});

/*app.get('/api/transaction/:type', (req, res) => {
    const { type } = req.params;
    if (!['basic', 'standard', 'ultra'].includes(type)) {
        return res.status(400).json({ error: 'Invalid transaction type.' });
    }
    try {
        const transaction = generateTransaction(type, req, res);
        res.cookie('transactionId', transaction.id, { httpOnly: false, maxAge: halfday });
        res.status(201).json({
            id: transaction.id,
            expiresAt: transaction.expiresAt,
            type: transaction.type,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});*/

app.get('/api/status/:id', (req, res) => {
    const { id } = req.params;
    try {
        const result = validateTransactionID(id);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/metadata/:id', (req, res) => {
    const { id } = req.params;
    try {
        const result = validateTransactionID(id);
        if (result.valid) {
            const ta = transactions.get(id);
            res.status(200).json(ta.items);
        } else {
            res.status(403).json({ success: false, error: result.message })
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/getSong/:name', (req, res) => {
    const { name } = req.params;
    const id = req.cookies.transactionId;
    try {
        const result = validateTransactionID(id);
        if (result.valid) {
            const ta = transactions.get(id);
            const dictEntry = mediaDictionary.find(s => s.title === name);
            const txEntry = ta.items.find(s => s.title === name);
            if (dictEntry && txEntry) {
                res.sendFile(`./media/${txEntry.rarity}/${txEntry.src}`, { root: '.' });
            } else {
                res.status(403).json({ success: false, error: "Current transaction does not authorize access to this song."});
            }
        } else {
            res.status(403).json({ success: false, error: result.message })
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/getTtml/:name', (req, res) => {
    const { name } = req.params;
    const id = req.cookies.transactionId;
    try {
        const result = validateTransactionID(id);
        if (result.valid) {
            const ta = transactions.get(id);
            const dictEntry = mediaDictionary.find(s => s.title === name);
            const txEntry = ta.items.find(s => s.title === name);
            if (dictEntry && txEntry) {
                const baseName = path.basename(txEntry.src, path.extname(txEntry.src));
                const ttmlPath = `./media/ttml/${baseName}.ttml`;

                if (fs.existsSync(ttmlPath)) {
                    res.sendFile(ttmlPath, { root: '.' });
                } else {
                    res.status(404).json({ success: false, error: "TTML file not found for this song." });
                }
            } else {
                res.status(403).json({ success: false, error: "Current transaction does not authorize access to this song."});
            }
        } else {
            res.status(403).json({ success: false, error: result.message })
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/can-download', (req, res) => {
    const encryptedKey = req.cookies.downloadKey;
    const transactionId = req.cookies.transactionId;
    try {
        const result = validateDownloadKey(encryptedKey, transactionId);
        res.status(200).json({ success: result.valid });
    } catch {
        res.status(200).json({ success: false });
    }
});

app.get('/api/downloadSong/:name', (req, res) => {
    const { name } = req.params;
    const encryptedKey = req.cookies.downloadKey;
    const transactionId = req.cookies.transactionId;

    // 1. Verify IP and User-Agent match the transaction
    const txResult = validateTransactionID(transactionId);
    if (!txResult.valid) {
        return res.status(403).json({ success: false, message: txResult.message });
    }
    const ta = transactions.get(transactionId);

    if (req.ip !== ta.ip || req.get('User-Agent') !== ta.userAgent) {
        return res.status(403).json({
            success: false,
            message: 'This download link is tied to a different device or network. Access denied.'
        });
    }

    // 2. Validate the download key
    const keyResult = validateDownloadKey(encryptedKey, transactionId);
    if (!keyResult.valid) {
        return res.status(403).json({ success: false, message: keyResult.message });
    }

    // 3. Check download attempt limit (max 3)
    if (ta.downloadAttempts >= 3) {
        return res.status(403).json({
            success: false,
            message: 'You have used all 3 of your download attempts for this transaction. No further downloads are allowed.'
        });
    }

    // 4. Verify the song belongs to this transaction
    const dictEntry = mediaDictionary.find(s => s.title === name);
    const txEntry = ta.items.find(s => s.title === name);
    if (!dictEntry || !txEntry) {
        return res.status(403).json({
            success: false,
            message: 'This song is not part of your current transaction.'
        });
    }

    // 5. Increment attempt counter before serving
    ta.downloadAttempts += 1;

    // 6. If this is the 3rd (final) download, clear the downloadKey cookie
    if (ta.downloadAttempts >= 3) {
        res.clearCookie('downloadKey');
    }

    // 7. Serve the file as an attachment (triggers browser download)
    const filePath = path.resolve(`./media/${txEntry.rarity}/${txEntry.src}`);
    res.download(filePath, txEntry.src, (err) => {
        if (err && !res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to send the file. Please try again.' });
        }
    });
});

const upload = multer({ storage: multer.memoryStorage() });

app.get('/admin', (req, res) => {
    if (req.ip.includes('192.168.1.') || req.ip.includes('127.0.0.1')) {
        res.sendFile(path.resolve('src/admin.html'));
    } else {
        res.status(403).json({ success: false, error: "Access denied." });
    }
});

app.post('/api/postSong', upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'ttml',  maxCount: 1 },
]), async (req, res) => {
    try {
        const { title, description = '', rarity } = req.body;
        const audioFile = req.files?.['audio']?.[0];
        const ttmlFile  = req.files?.['ttml']?.[0];

        // ── Validation ──
        if (!audioFile)  return res.status(400).json({ error: 'Audio file is required.' });
        if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
        if (!['common', 'uncommon', 'rare', 'legendary'].includes(rarity)) {
            return res.status(400).json({ error: 'Invalid rarity value.' });
        }

        // ── Derive filenames ──
        const audioOriginal = audioFile.originalname;                   // e.g. "my-song.mp3"
        const audioExt      = path.extname(audioOriginal);              // e.g. ".mp3"
        const audioBaseName = path.basename(audioOriginal, audioExt);  // e.g. "my-song"
        const audioSrc      = `${audioBaseName}${audioExt}`;           // stored in toc

        // ── Ensure directories exist ──
        const rarityDir = path.resolve(`./media/${rarity}`);
        const ttmlDir   = path.resolve(`./media/ttml`);
        fs.mkdirSync(rarityDir, { recursive: true });
        if (ttmlFile) fs.mkdirSync(ttmlDir, { recursive: true });

        // ── Save audio file ──
        const audioDestPath = path.join(rarityDir, audioSrc);
        fs.writeFileSync(audioDestPath, audioFile.buffer);

        // ── Save TTML file (optional) ──
        if (ttmlFile) {
            const ttmlDestPath = path.join(ttmlDir, `${audioBaseName}.ttml`);
            fs.writeFileSync(ttmlDestPath, ttmlFile.buffer);
        }

        // ── Update toc.json ──
        const tocPath = path.resolve('./media/toc.json');
        let toc = [];
        try {
            const raw = fs.readFileSync(tocPath, 'utf8');
            toc = JSON.parse(raw);
        } catch {
            // toc.json missing or empty — start fresh
            toc = [];
        }

        toc.push({
            title:       title.trim(),
            description: description.trim(),
            rarity,
            src:         audioSrc,
        });

        fs.writeFileSync(tocPath, JSON.stringify(toc, null, 4), 'utf8');

        return res.sendStatus(200);
    } catch (err) {
        console.error('[postSong]', err);
        return res.status(500).json({ error: err.message });
    }
});

app.use(express.static('public'));
app.use('/vendor/wavesurfer', express.static('./node_modules/wavesurfer.js/dist'));

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}

export default app;