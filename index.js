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

const ATTENDANCE_WEBHOOK_URL = process.env.WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbygD1VyBg73HQ7ENPTBVJZlt1efIZcQtSIxJSRrZqUY_HS-ZbnnYhvU6OMnmFiVFhOlWg/exec";
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

// ===================================================================
// WEB SERVER (Untuk Tampilan QR Code & Anti-Sleep)
// ===================================================================

const app = express();
let currentQRDataURL = null;
let isConnected = false;
let lastLog = "Menunggu inisialisasi...";

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Bot Hungreens 24 Jam</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 40px 20px; background: #f8fafc; color: #1e293b; }
          .card { max-width: 480px; margin: 0 auto; background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
          .badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 20px; }
          .badge-online { background: #dcfce7; color: #15803d; }
          .badge-wait { background: #fef3c7; color: #b45309; }
          .btn { display: inline-block; padding: 10px 20px; background: #0284c7; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; }
          .feature { text-align: left; background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin-top: 15px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🥗 Hungreens All-in-One Bot</h2>
          ${isConnected 
            ? `<div class="badge badge-online">● Bot Aktif & Terhubung ke WhatsApp</div>` 
            : `<div class="badge badge-wait">⏳ Perlu Scan WhatsApp</div><p><a class="btn" href="/qr">Buka Halaman Scan QR Code</a></p>`
          }
          <div class="feature">
            <strong>Fitur Otomatis Aktif:</strong><br>
            📍 <strong>Absensi:</strong> Shareloc otomatis masuk ke Jadwal Shift.<br>
            💸 <strong>Pengeluaran:</strong> Laporan biaya (teks/nota) otomatis masuk ke OPEX / CAPEX.
          </div>
          <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">
          <p style="font-size:12px; color:#64748b;">Status Terakhir: ${lastLog}</p>
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
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 30px 15px; background: #f8fafc; }
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

app.listen(PORT, () => {
  console.log(`🌐 Web server berjalan di port ${PORT}`);
});

// ===================================================================
// BAILEYS WHATSAPP CLIENT
// ===================================================================

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
      lastLog = "QR Code siap di-scan di halaman /qr";
    }

    if (connection === "close") {
      isConnected = false;
      currentQRDataURL = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      lastLog = `Koneksi terputus (status: ${statusCode}). Reconnecting: ${shouldReconnect}`;
      if (shouldReconnect) startWhatsAppBot();
    } else if (connection === "open") {
      isConnected = true;
      currentQRDataURL = null;
      lastLog = "✅ Berhasil terhubung ke WhatsApp Hungreens!";
      console.log(lastLog);
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg.message) return;

      const isGroup = msg.key.remoteJid.endsWith("@g.us");
      if (!isGroup) return; // Hanya proses di grup

      const messageContent = msg.message;
      const senderJid = msg.key.participant || msg.key.remoteJid;
      const cleanPhone = senderJid.replace(/@.+/, "").replace(/\D/g, "");
      const pushName = msg.pushName || "Tim Hungreens";
      const senderName = EMPLOYEE_MAP[cleanPhone] || pushName;

      // Waktu Pesan
      const timestampSeconds = msg.messageTimestamp;
      const dateObj = new Date(Number(timestampSeconds) * 1000);
      const timeStr = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(dateObj).replace(".", ":");
      const dayName = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" }).format(dateObj).toUpperCase();
      const dateNum = parseInt(new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric" }).format(dateObj), 10);
      const fullDateStr = `${dateNum} November 2026`;

      // ==============================================================
      // 1. JIKA PESAN BERUPA SHARE LOCATION -> MODUL ABSENSI
      // ==============================================================
      const isLocation = messageContent.locationMessage || messageContent.liveLocationMessage;
      if (isLocation) {
        if (msg.key.fromMe) return; // Abaikan shareloc dari bot sendiri

        console.log(`\n📍 Shareloc Diterima: ${senderName} (${timeStr} WIB)`);
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
        console.log("📊 Respon Absensi:", result);
        return;
      }

      // ==============================================================
      // 2. JIKA PESAN TEKS ATAU GAMBAR -> MODUL PENGELUARAN
      // ==============================================================
      if (!EXPENSE_WEBHOOK_URL) return; // Belum disetel webhook pengeluaran

      // Ambil teks pesan (bisa berupa teks biasa atau caption foto)
      let text = messageContent.conversation 
        || messageContent.extendedTextMessage?.text 
        || messageContent.imageMessage?.caption 
        || "";

      // Cek apakah pesan berupa gambar nota tanpa caption
      let imageBase64 = null;
      if (messageContent.imageMessage && GEMINI_API_KEY) {
        try {
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          imageBase64 = buffer.toString("base64");
        } catch (e) {
          console.error("Gagal mendownload gambar nota:", e);
        }
      }

      if (!text && !imageBase64) return; // Bukan teks dan bukan gambar

      // Analisis menggunakan AI / Smart Parser
      const expense = await parseExpenseWithAI(text, imageBase64, GEMINI_API_KEY);

      if (expense && expense.isExpense) {
        console.log(`\n💸 Pengeluaran Terdeteksi: ${expense.item} - Rp ${expense.total.toLocaleString("id-ID")} [${expense.category}]`);

        const payload = {
          category: expense.category, // OPEX atau CAPEX
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
        console.log("📊 Respon Spreadsheet Pengeluaran:", result);

        // Balas langsung di grup WhatsApp (Reply)
        const formatRupiah = `Rp ${Number(expense.total).toLocaleString("id-ID")}`;
        const replyText = `✅ *Tercatat ke [${expense.category} - ${getWeekTabName(dateNum)}]*\n`
          + `• *Item:* ${expense.item} ${expense.qty ? `(${expense.qty})` : ""}\n`
          + `• *Total:* ${formatRupiah}\n`
          + `• *Pelapor:* ${senderName}`;

        await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
      }

    } catch (err) {
      console.error("Error memproses pesan:", err);
    }
  });
}

/**
 * Membedah chat atau foto nota menggunakan Gemini AI atau Rule-Based Parser
 */
async function parseExpenseWithAI(text, imageBase64, apiKey) {
  // 1. Gunakan Gemini AI jika API Key tersedia (Paling Pintar: Tahu Obrolan vs Biaya & Baca Nota)
  if (apiKey) {
    try {
      const parts = [];
      if (imageBase64) {
        parts.push({
          inlineData: { mimeType: "image/jpeg", data: imageBase64 }
        });
      }
      if (text) {
        parts.push({ text: `Pesan chat: "${text}"` });
      } else {
        parts.push({ text: "Analisis foto nota belanja ini." });
      }

      const prompt = `Kamu adalah asisten keuangan untuk outlet makanan sehat bernama 'Hungreens' di Indonesia.
Tugasmu: Analisis apakah pesan/foto ini merupakan laporan pengeluaran/belanja operasional.
Aturan Kategori:
- OPEX: Bahan baku makanan/minuman (buah, sayur, ayam, ikan, bumbu/saus, minyak, beras/rice paper, keju) dan kemasan makanan (plastik kresek, lunch box, cup).
- CAPEX: Kebutuhan operasional outlet non-makanan (listrik/token PLN, air/PDAM, gas elpiji, galon air, wifi/internet, sabun pel, pembersih dapur, tisu, cetak stiker, perlengkapan toko).
- Jika HANYA obrolan biasa, pertanyaan, sapaan, atau diskusi yang bukan belanjaan -> set isExpense: false.

Kembalikan format JSON persis seperti ini:
{
  "isExpense": true atau false,
  "category": "OPEX" atau "CAPEX",
  "item": "nama barang",
  "qty": "jumlah jika ada (contoh: 2 kg, 1 pak, 2 dus, atau kosongkan jika tidak ada)",
  "total": angka murni nominal rupiah tanpa titik/koma (contoh: 22000),
  "ket": "keterangan tambahan jika ada (nama toko/supplier/faktur)"
}`;

      parts.unshift({ text: prompt });

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: parts }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawText) {
        return JSON.parse(rawText);
      }
    } catch (e) {
      console.error("Gemini API Error, fallback ke regex:", e);
    }
  }

  // 2. Fallback Rule-Based Parser (Jika tanpa API Key)
  return parseExpenseFallback(text);
}

function parseExpenseFallback(text) {
  if (!text) return { isExpense: false };
  const lower = text.toLowerCase();

  // Filter obrolan biasa
  if (lower.includes("jangan lupa") || lower.includes("besok") || lower.includes("jadwal") || lower.includes("masuk") || lower.includes("halo") || lower.includes("pagi")) {
    return { isExpense: false };
  }

  // Cari angka nominal (misal: 22rb, 22.000, 50k, 100000)
  const nominalMatch = lower.match(/(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(rb|k|ribu)?/i);
  if (!nominalMatch) return { isExpense: false };

  let rawNum = nominalMatch[1].replace(/[.,]/g, "");
  let multiplier = 1;
  const unit = (nominalMatch[2] || "").toLowerCase();
  if (unit === "rb" || unit === "k" || unit === "ribu") multiplier = 1000;
  let total = parseInt(rawNum, 10) * multiplier;

  if (total < 1000) return { isExpense: false }; // Di bawah 1000 biasanya bukan belanjaan

  // Bersihkan teks barang
  let item = text.replace(nominalMatch[0], "").replace(/beli|bayar|tadi|untuk/gi, "").trim();
  if (!item) item = "Belanja Operasional";

  // Tentukan Kategori OPEX vs CAPEX
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
