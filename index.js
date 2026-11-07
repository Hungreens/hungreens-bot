import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason,
  downloadMediaMessage 
} from "@whiskeysockets/baileys";
import express from "express";
import QRCode from "qrcode";
import pino from "pino";

// ===================================================================
// KONFIGURASI BOT HUNGREENS CLOUD 24 JAM (ABSENSI & PENGELUARAN)
// ===================================================================

const DEFAULT_ATTENDANCE_WEBHOOK = "https://script.google.com/macros/s/AKfycbygD1VyBg73HQ7ENPTBVJZlt1efIZcQtSIxJSRrZqUY_HS-ZbnnYhvU6OMnmFiVFhOlWg/exec";

let ATTENDANCE_WEBHOOK_URL = process.env.WEBHOOK_URL || DEFAULT_ATTENDANCE_WEBHOOK;
if (!ATTENDANCE_WEBHOOK_URL || ATTENDANCE_WEBHOOK_URL.includes("docs.google.com")) {
  ATTENDANCE_WEBHOOK_URL = DEFAULT_ATTENDANCE_WEBHOOK;
}

const EXPENSE_WEBHOOK_URL = process.env.EXPENSE_WEBHOOK_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PORT = process.env.PORT || 3000;

const EMPLOYEE_MAP = {
  "6285819727906": "IFA",
  "6285708752712": "ISNA",
  "6285746582094": "AMEL",
  "6288805150800": "CINTA",
  "6287850296928": "NEGA",
  "628888397518":  "RISNA",
  "6285536859369": "VISKA"
};

// Penyimpanan Log Aktivitas (Maksimal 30 pesan terakhir untuk live monitoring)
const activityLogs = [];
function addLog(action, detail) {
  const time = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
  activityLogs.unshift(`[${time}] ${action}: ${detail}`);
  if (activityLogs.length > 30) activityLogs.pop();
  console.log(`[${time}] ${action}: ${detail}`);
}

// ===================================================================
// WEB SERVER (Untuk Tampilan QR Code, Anti-Sleep, & Live Logs)
// ===================================================================

const app = express();
let currentQRDataURL = null;
let isConnected = false;

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Bot Hungreens 24 Jam</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 30px 15px; background: #f8fafc; color: #1e293b; }
          .card { max-width: 580px; margin: 0 auto; background: white; padding: 25px; border-radius: 16px; box-shadow: 0 4px 25px rgba(0,0,0,0.07); text-align: left; }
          .badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 15px; }
          .badge-online { background: #dcfce7; color: #15803d; }
          .badge-wait { background: #fef3c7; color: #b45309; }
          .btn { display: inline-block; padding: 8px 16px; background: #0284c7; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; font-size: 13px; }
          .feature { background: #f1f5f9; padding: 14px 16px; border-radius: 10px; margin-top: 15px; font-size: 13px; line-height: 1.6; }
          .log-box { background: #0f172a; color: #38bdf8; padding: 12px; border-radius: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; max-height: 230px; overflow-y: auto; margin-top: 15px; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="text-align:center;">
            <h2 style="margin: 0 0 10px 0;">🥗 Hungreens All-in-One Bot</h2>
            ${isConnected 
              ? `<div class="badge badge-online">● Bot Aktif & Terhubung ke WhatsApp</div>` 
              : `<div class="badge badge-wait">⏳ Perlu Scan WhatsApp</div><p><a class="btn" href="/qr">Buka Halaman Scan QR Code</a></p>`
            }
          </div>

          <div class="feature">
            <strong>⚙️ Status Konfigurasi & Grup Aktif:</strong><br>
            • 📍 <strong>Grup Absensi:</strong> "absensi hungreens" (Shareloc &rarr; Google Sheets)<br>
            • 💸 <strong>Grup Pengeluaran:</strong> "pengeluaran salad" (Nota/Struk/Transfer &rarr; OPEX & CAPEX)<br>
            • 🔒 <strong>Grup Lain:</strong> Otomatis diabaikan untuk menjaga privasi.<br>
            • 🧠 <strong>Gemini AI Key:</strong> ${GEMINI_API_KEY 
                ? `<span style='color:#15803d; font-weight:bold;'>✅ Aktif (${GEMINI_API_KEY.substring(0, 6)}...)</span>` 
                : "<span style='color:#dc2626; font-weight:bold;'>⚠️ Belum Terpasang (GEMINI_API_KEY)</span>"}
          </div>

          <h4 style="margin: 20px 0 5px 0;">📋 Log Aktivitas Terakhir (Live):</h4>
          <div class="log-box">
            ${activityLogs.length > 0 
              ? activityLogs.map(l => `<div>${l}</div>`).join("") 
              : "<div>Menunggu pesan masuk di grup Hungreens...</div>"
            }
          </div>
          <p style="font-size:11px; color:#64748b; text-align:center; margin-top:12px;">Refresh browser ini untuk memperbarui log secara langsung.</p>
        </div>
      </body>
    </html>
  `);
});

app.get("/qr", (req, res) => {
  if (isConnected) return res.redirect("/");
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Scan QR WhatsApp - Hungreens</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="5">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 30px 15px; background: #f8fafc; }
          .card { max-width: 380px; margin: 0 auto; background: white; padding: 25px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
          img { border-radius: 12px; border: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h3>📱 Scan QR Code WhatsApp</h3>
          <p style="font-size: 13px; color: #64748b;">Buka WhatsApp di HP &rarr; Perangkat Tertaut &rarr; Tautkan Perangkat</p>
          ${currentQRDataURL 
            ? `<img src="${currentQRDataURL}" width="260" height="260" alt="QR Code WhatsApp" />` 
            : `<p>Sedang membuat QR Code baru... (halaman refresh otomatis)</p>`
          }
        </div>
      </body>
    </html>
  `);
});

app.get("/ping", (req, res) => res.send("PONG - Bot Awake!"));

app.get("/logs", (req, res) => {
  res.json({
    isConnected,
    config: {
      attendanceUrl: ATTENDANCE_WEBHOOK_URL,
      expenseUrl: EXPENSE_WEBHOOK_URL,
      hasExpenseWebhook: !!EXPENSE_WEBHOOK_URL,
      hasGeminiApiKey: !!GEMINI_API_KEY
    },
    logs: activityLogs
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Web server berjalan di port ${PORT}`);
});

// ===================================================================
// BAILEYS WHATSAPP CLIENT
// ===================================================================

const groupNameCache = new Map();
async function getGroupName(sock, jid) {
  if (groupNameCache.has(jid)) return groupNameCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    const name = meta.subject || "";
    groupNameCache.set(jid, name);
    return name;
  } catch (e) {
    return "";
  }
}

function unwrapMessage(msg) {
  let m = msg.message;
  if (!m) return {};
  while (m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.documentWithCaptionMessage) {
    m = m.ephemeralMessage?.message 
      || m.viewOnceMessage?.message 
      || m.viewOnceMessageV2?.message 
      || m.documentWithCaptionMessage?.message;
  }
  return m || {};
}

function cleanAndParseJSON(str) {
  if (!str) return null;
  let cleaned = str.replace(/```json/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

// Cek daftar model yang aktif secara dinamis untuk akun pengguna
let cachedModelName = null;
async function getAvailableModel(apiKey) {
  if (cachedModelName) return cachedModelName;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      headers: { "x-goog-api-key": apiKey }
    });
    const data = await res.json();
    if (data.models && Array.isArray(data.models)) {
      const supported = data.models.filter(m => m.supportedGenerationMethods?.includes("generateContent"));
      // Utamakan model flash (seperti gemini-2.5-flash atau gemini-2.0-flash)
      const flash = supported.find(m => m.name.includes("flash"));
      const picked = flash || supported[0];
      if (picked) {
        cachedModelName = picked.name.replace(/^models\//, "");
        addLog("AI MODEL", `Model aktif yang dipilih: ${cachedModelName}`);
        return cachedModelName;
      }
    }
  } catch (e) {
    console.error("Gagal mendeteksi model:", e);
  }
  return "gemini-2.5-flash"; // Fallback standar generasi terbaru
}

async function startWhatsAppBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_session");

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" })
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQRDataURL = await QRCode.toDataURL(qr);
    }

    if (connection === "close") {
      isConnected = false;
      currentQRDataURL = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      addLog("KONEKSI", `Koneksi terputus (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) startWhatsAppBot();
    } else if (connection === "open") {
      isConnected = true;
      currentQRDataURL = null;
      addLog("KONEKSI", "✅ Berhasil terhubung ke WhatsApp Hungreens!");
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      // 1. PENGAMAN UTAMA: Jangan pernah baca pesan yang dikirim oleh bot itu sendiri!
      if (msg.key.fromMe) return;

      // 2. Hanya proses pesan yang ada di grup
      const isGroup = msg.key.remoteJid.endsWith("@g.us");
      if (!isGroup) return;

      // 3. FILTER NAMA GRUP: Hanya baca grup "absensi hungreens" dan "pengeluaran salad"
      const groupName = (await getGroupName(sock, msg.key.remoteJid)).toLowerCase();
      const isAttendanceGroup = groupName.includes("absen");
      const isExpenseGroup = groupName.includes("pengeluaran") || groupName.includes("salad");

      if (!isAttendanceGroup && !isExpenseGroup) {
        // Abaikan semua grup lain (grup teman, komunitas, story pedia, dll)
        return;
      }

      // Buka bungkusan pesan (mendukung pesan sementara / ephemeral / view once)
      const content = unwrapMessage(msg);

      const senderJid = msg.key.participant || msg.key.remoteJid;
      const cleanPhone = senderJid.replace(/@.+/, "").replace(/\D/g, "");
      const pushName = msg.pushName || "Karyawan";
      const senderName = EMPLOYEE_MAP[cleanPhone] || pushName;

      // Waktu Pesan
      const timestampSeconds = msg.messageTimestamp;
      const dateObj = new Date(Number(timestampSeconds) * 1000);
      const timeStr = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(dateObj).replace(".", ":");
      const dayName = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" }).format(dateObj).toUpperCase();
      const dateNum = parseInt(new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric" }).format(dateObj), 10);
      const fullDateStr = `${dateNum} November 2026`;

      // ==============================================================
      // MODUL 1: ABSENSI (HANYA AKTIF DI GRUP ABSENSI)
      // ==============================================================
      if (isAttendanceGroup) {
        const isLocation = content.locationMessage || content.liveLocationMessage;
        if (isLocation) {
          addLog("ABSENSI", `📍 Shareloc dari ${senderName} (${timeStr} WIB, tgl ${dateNum})`);

          const payload = {
            name: senderName,
            phone: cleanPhone,
            time: timeStr,
            dayName: dayName,
            dateNum: dateNum
          };

          const response = await fetch(ATTENDANCE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const result = await response.json();
          addLog("SHEET ABSEN", `Respon: ${JSON.stringify(result)}`);
        }
        return; // Jangan lanjutkan ke modul pengeluaran jika di grup absensi
      }

      // ==============================================================
      // MODUL 2: PENGELUARAN (HANYA AKTIF DI GRUP PENGELUARAN SALAD)
      // ==============================================================
      if (isExpenseGroup) {
        let text = content.conversation 
          || content.extendedTextMessage?.text 
          || content.imageMessage?.caption 
          || "";

        let imageBase64 = null;
        let imageMime = "image/jpeg";

        if (content.imageMessage) {
          imageMime = (content.imageMessage.mimetype || "image/jpeg").split(";")[0].trim();
          addLog("GAMBAR", `Mendownload foto nota/transfer dari ${senderName}...`);
          try {
            const unwrappedMsg = { key: msg.key, message: content };
            const buffer = await downloadMediaMessage(unwrappedMsg, "buffer", {});
            imageBase64 = buffer.toString("base64");
            addLog("GAMBAR", `📸 Foto berhasil diunduh (${(buffer.length / 1024).toFixed(1)} KB)`);
          } catch (e) {
            addLog("ERROR GAMBAR", `Gagal download foto: ${e.message}`);
          }
        }

        if (!text && !imageBase64) return;

        if (text) {
          addLog("TEKS", `"${text}" dari ${senderName}`);
        }

        // Analisis menggunakan AI / Smart Parser
        const expense = await parseExpenseWithAI(text, imageBase64, imageMime, GEMINI_API_KEY);

        if (expense && expense.isExpense) {
          const formatRupiah = `Rp ${Number(expense.total).toLocaleString("id-ID")}`;
          addLog("PENGELUARAN", `💸 Terdeteksi: ${expense.item} (${formatRupiah}) [${expense.category}]`);

          if (!EXPENSE_WEBHOOK_URL || EXPENSE_WEBHOOK_URL.includes("docs.google.com")) {
            addLog("PERINGATAN", "EXPENSE_WEBHOOK_URL belum disetel di Render!");
            return;
          }

          const payload = {
            category: expense.category,
            item: expense.item,
            qty: expense.qty || "",
            total: expense.total,
            ket: expense.ket || `Dilaporkan oleh ${senderName}`,
            dateNum: dateNum,
            dateStr: fullDateStr
          };

          const res = await fetch(EXPENSE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const result = await res.json();
          addLog("SHEET PENGELUARAN", `Respon: ${JSON.stringify(result)}`);

          // Balas langsung di grup WhatsApp (Reply)
          const replyText = `✅ *Tercatat ke [${expense.category} - ${getWeekTabName(dateNum)}]*\n`
            + `• *Item:* ${expense.item} ${expense.qty ? `(${expense.qty})` : ""}\n`
            + `• *Total:* ${formatRupiah}\n`
            + `• *Pelapor:* ${senderName}`;

          await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
        } else {
          // Jika ada foto dikirim tetapi AI tidak mendeteksi nominal
          if (imageBase64) {
            addLog("INFO", "Foto belum terdeteksi rincian biayanya");
            const fallbackReply = `ℹ️ Foto struk/transfer diterima, namun rincian nominal belum terdeteksi.\n\nSilakan ketik rinciannya di grup ya (contoh: *beli semangka 50rb*).`;
            await sock.sendMessage(msg.key.remoteJid, { text: fallbackReply }, { quoted: msg });
          }
        }
      }

    } catch (err) {
      addLog("ERROR", err.message);
      console.error("Error memproses pesan:", err);
    }
  });
}

async function parseExpenseWithAI(text, imageBase64, imageMime, apiKey) {
  if (apiKey) {
    try {
      const parts = [];
      if (imageBase64) {
        parts.push({ inlineData: { mimeType: imageMime || "image/jpeg", data: imageBase64 } });
      }
      if (text) {
        parts.push({ text: `Pesan chat pengeluaran: "${text}"` });
      } else {
        parts.push({ text: "Analisis foto bukti transfer, struk belanja, atau nota pembelian ini. Baca nama barang/keperluan, jumlah qty jika ada, dan TOTAL nominal rupiah yang dibayarkan." });
      }

      const prompt = `Kamu adalah asisten keuangan untuk outlet makanan sehat bernama 'Hungreens' di Indonesia.
Tugasmu: Analisis apakah pesan/foto ini merupakan laporan pengeluaran, nota belanja, atau bukti transfer operasional.
Aturan Kategori:
- OPEX: Bahan baku makanan/minuman (buah, sayur, ayam, ikan, bumbu/saus, minyak, beras/rice paper, keju, chia seed) dan kemasan makanan (plastik kresek, lunch box, cup).
- CAPEX: Kebutuhan operasional outlet non-makanan (listrik/token PLN, air/PDAM, gas elpiji, galon air, wifi/internet, sabun pel, pembersih dapur, tisu, cetak stiker, perlengkapan toko).
- Jika HANYA obrolan biasa, pertanyaan, sapaan, atau diskusi yang bukan biaya -> set isExpense: false.

Kembalikan format JSON persis seperti ini (hanya JSON, tanpa format markdown):
{
  "isExpense": true atau false,
  "category": "OPEX" atau "CAPEX",
  "item": "nama barang / keperluan transfer",
  "qty": "jumlah jika ada (contoh: 5 kg, 2 pcs)",
  "total": angka murni nominal rupiah tanpa titik/koma (contoh: 697440),
  "ket": "keterangan toko / supplier / nama penerima"
}`;

      parts.unshift({ text: prompt });

      // Deteksi model yang tersedia secara dinamis
      const modelName = await getAvailableModel(apiKey);
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey 
        },
        body: JSON.stringify({
          contents: [{ parts: parts }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const data = await res.json();
      
      if (!res.ok || data.error) {
        const errorMsg = data?.error?.message || `HTTP ${res.status}`;
        addLog("AI ERROR", `Gemini API Gagal: ${errorMsg}`);
      } else {
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = cleanAndParseJSON(rawText);
          if (parsed && typeof parsed.total === "number" && parsed.total > 0) {
            return parsed;
          }
        }
      }
    } catch (e) {
      addLog("AI EXCEPTION", e.message);
      console.error("Gemini API Exception, fallback ke regex:", e);
    }
  }

  return parseExpenseFallback(text);
}

function parseExpenseFallback(text) {
  if (!text) return { isExpense: false };

  // Abaikan pesan otomatis bot sendiri atau pesan instruksi
  if (text.includes("contoh:") || text.includes("Foto struk/transfer") || text.includes("Foto bukti") || text.includes("Tercatat ke [")) {
    return { isExpense: false };
  }

  const lower = text.toLowerCase();
  if (lower.includes("jangan lupa") || lower.includes("besok") || lower.includes("jadwal") || lower.includes("masuk") || lower.includes("halo") || lower.includes("pagi")) {
    return { isExpense: false };
  }

  const nominalMatch = lower.match(/(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(rb|k|ribu)?/i);
  if (!nominalMatch) return { isExpense: false };

  let rawNum = nominalMatch[1].replace(/[.,]/g, "");
  let multiplier = 1;
  const unit = (nominalMatch[2] || "").toLowerCase();
  if (unit === "rb" || unit === "k" || unit === "ribu") multiplier = 1000;
  let total = parseInt(rawNum, 10) * multiplier;

  if (total < 1000) return { isExpense: false };

  let item = text.replace(nominalMatch[0], "").replace(/beli|bayar|tadi|untuk/gi, "").trim();
  if (!item || item.length > 50) item = "Belanja Operasional";

  const capexKeywords = ["gas", "elpiji", "galon", "token", "pln", "listrik", "air", "pdam", "wifi", "indosat", "sabun", "pel", "tisu", "stiker", "sarung tangan"];
  const isCapex = capexKeywords.some(k => item.toLowerCase().includes(k));

  return {
    isExpense: true,
    category: isCapex ? "CAPEX" : "OPEX",
    item: item,
    qty: "",
    total: total,
    ket: ""
  };
}

function getWeekTabName(dateNum) {
  if (dateNum >= 1 && dateNum <= 7) return "Minggu 1";
  if (dateNum >= 8 && dateNum <= 14) return "Minggu 2";
  if (dateNum >= 15 && dateNum <= 21) return "Minggu 3";
  if (dateNum >= 22 && dateNum <= 28) return "Minggu 4";
  return "Minggu 5";
}

startWhatsAppBot();
