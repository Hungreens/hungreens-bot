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

const EXPENSE_WEBHOOK_URL = process.env.EXPENSE_WEBHOOK_URL || "https://script.google.com/macros/s/AKfycbz4sbrv0czJ0O3EXcwRptUfjXNS_CA6UdrYXXFlYl08Fo-pzrhDeBe9vjeOtrffLVzL7g/exec";
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
          .log-box { background: #0f172a; color: #38bdf8; padding: 12px; border-radius: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; max-height: 260px; overflow-y: auto; margin-top: 15px; line-height: 1.5; }
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
            <strong>⚙️ Status Konfigurasi & Grup:</strong><br>
            • 📍 <strong>Grup Absensi:</strong> "absensi hungreens"<br>
            • 💸 <strong>Grup Pengeluaran:</strong> "pengeluaran salad"<br>
            • 🧠 <strong>Gemini AI Key:</strong> ${GEMINI_API_KEY 
                ? `<span style='color:#15803d; font-weight:bold;'>✅ Aktif (${GEMINI_API_KEY.substring(0, 6)}...)</span>` 
                : "<span style='color:#dc2626; font-weight:bold;'>⚠️ Belum Terpasang (GEMINI_API_KEY)</span>"}
          </div>

          <h4 style="margin: 20px 0 5px 0;">📋 Log Aktivitas Terakhir (Live):</h4>
          <div class="log-box">
            ${activityLogs.length > 0 
              ? activityLogs.map(l => `<div>${l}</div>`).join("") 
              : "<div>Menunggu pesan masuk di grup WhatsApp...</div>"
            }
          </div>
          <p style="font-size:11px; color:#64748b; text-align:center; margin-top:12px;">Refresh browser ini untuk melihat aktivitas terbaru.</p>
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

async function refreshAllGroupNames(sock) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (const [id, meta] of Object.entries(groups)) {
      if (meta && meta.subject) {
        groupNameCache.set(id, meta.subject.toLowerCase());
      }
    }
    console.log(`Berhasil memuat ${groupNameCache.size} daftar nama grup WhatsApp.`);
  } catch (e) {
    console.error("Gagal refresh groupFetchAllParticipating:", e.message);
  }
}

async function getGroupName(sock, jid) {
  if (groupNameCache.has(jid)) return groupNameCache.get(jid);
  try {
    const meta = await sock.groupMetadata(jid);
    if (meta && meta.subject) {
      const s = meta.subject.toLowerCase();
      groupNameCache.set(jid, s);
      return s;
    }
  } catch (e) {}
  return "";
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
      // Pra-muat seluruh nama grup saat koneksi terbuka
      await refreshAllGroupNames(sock);
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      if (!msg || !msg.message) return;

      // Hanya proses pesan di grup
      const isGroup = msg.key.remoteJid.endsWith("@g.us");
      if (!isGroup) return;

      // Buka bungkusan pesan (mendukung pesan sementara / ephemeral / view once)
      const content = unwrapMessage(msg);

      let text = content.conversation 
        || content.extendedTextMessage?.text 
        || content.imageMessage?.caption 
        || "";

      // 1. PENGAMAN LOOP BOT:
      // Abaikan HANYA pesan yang diawali format konfirmasi bot
      if (text.startsWith("✅") || text.startsWith("ℹ️") || text.startsWith("⚠️") || text.includes("*Tercatat ke [")) {
        return;
      }

      // Ambil nama grup
      const groupName = await getGroupName(sock, msg.key.remoteJid);

      const isAttendanceGroup = groupName && groupName.includes("absen");
      const isExpenseGroup = groupName && (groupName.includes("pengeluaran") || groupName.includes("salad"));

      // HANYA proses jika pesan berasal dari grup Absensi atau Pengeluaran Salad!
      // Jika dari grup lain (STORY PEDIA, keluarga, teman, dll), langsung abaikan 100%!
      if (!isAttendanceGroup && !isExpenseGroup) {
        return;
      }

      const senderJid = msg.key.participant || msg.key.remoteJid;
      const cleanPhone = senderJid.replace(/@.+/, "").replace(/\D/g, "");
      const pushName = msg.pushName || (msg.key.fromMe ? "Owner (Dimmy)" : "Karyawan");
      const senderName = EMPLOYEE_MAP[cleanPhone] || pushName;

      // Cek tipe pesan
      const isLocation = !!(content.locationMessage || content.liveLocationMessage);
      const hasImage = !!content.imageMessage;

      // Waktu Pesan
      const timestampSeconds = msg.messageTimestamp;
      const dateObj = new Date(Number(timestampSeconds) * 1000);
      const timeStr = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(dateObj).replace(".", ":");
      const dayName = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" }).format(dateObj).toUpperCase();
      const dateNum = parseInt(new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric" }).format(dateObj), 10);
      const fullDateStr = `${dateNum} November 2026`;

      // Log pesan yang masuk langsung ke monitor
      const tipeMsg = isLocation ? "SHARELOC" : (hasImage ? "FOTO" : "TEKS");
      addLog("CHAT MASUK", `Dari ${senderName} [${tipeMsg}] di grup [${groupName}]`);

      // ==============================================================
      // MODUL 1: ABSENSI (HANYA AKTIF DI GRUP ABSENSI)
      // ==============================================================
      if (isAttendanceGroup) {
        if (!isLocation) return; // Grup absensi hanya menerima shareloc

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
        return;
      }

      // ==============================================================
      // MODUL 2: PENGELUARAN (HANYA AKTIF DI GRUP PENGELUARAN SALAD)
      // ==============================================================
      if (isExpenseGroup) {
        let imageBase64 = null;
        let imageMime = "image/jpeg";

        if (hasImage) {
          imageMime = (content.imageMessage.mimetype || "image/jpeg").split(";")[0].trim();
          addLog("GAMBAR", `Mendownload foto dari ${senderName}...`);
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

        // Analisis menggunakan AI / Smart Multi-Item Parser
        const expenseData = await parseExpenseWithAI(text, imageBase64, imageMime, GEMINI_API_KEY);

        if (expenseData && expenseData.isExpense && Array.isArray(expenseData.items) && expenseData.items.length > 0) {
          const items = expenseData.items;
          const grandTotal = items.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
          const formatGrandTotal = `Rp ${grandTotal.toLocaleString("id-ID")}`;
          const weekTab = getWeekTabName(dateNum);

          addLog("PENGELUARAN", `💸 ${items.length} item dicatat: Total ${formatGrandTotal} [${weekTab}]`);

          if (!EXPENSE_WEBHOOK_URL || EXPENSE_WEBHOOK_URL.includes("docs.google.com")) {
            addLog("PERINGATAN", "EXPENSE_WEBHOOK_URL belum disetel di Render!");
            return;
          }

          const payload = {
            items: items,
            dateNum: dateNum,
            dateStr: fullDateStr,
            ket: `Dilaporkan oleh ${senderName}`
          };

          const res = await fetch(EXPENSE_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const result = await res.json();
          addLog("SHEET PENGELUARAN", `Respon: ${JSON.stringify(result)}`);

          // Balas langsung di grup WhatsApp (Reply)
          let replyText = "";
          if (items.length === 1) {
            const it = items[0];
            const itemTotalStr = `Rp ${Number(it.total).toLocaleString("id-ID")}`;
            replyText = `✅ *Tercatat ke [${weekTab} - ${it.category}]*\n`
              + `• *Item:* ${it.item} ${it.qty ? `(${it.qty})` : ""}\n`
              + `• *Total:* ${itemTotalStr}\n`
              + (it.ket ? `• *Keterangan:* ${it.ket}\n` : "")
              + `• *Pelapor:* ${senderName}`;
          } else {
            replyText = `✅ *Tercatat ke [${weekTab}] (${items.length} item terpisah):*\n`;
            items.forEach((it, idx) => {
              const itPrice = `Rp ${Number(it.total).toLocaleString("id-ID")}`;
              const qtyStr = it.qty ? `(${it.qty}) ` : "";
              replyText += `${idx + 1}. *${it.item}* ${qtyStr}— ${itPrice} [${it.category}]\n`;
            });
            replyText += `\n💰 *Total Keseluruhan:* ${formatGrandTotal}\n`;
            replyText += `👤 *Pelapor:* ${senderName}`;
          }

          await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
        } else {
          if (imageBase64) {
            addLog("INFO", "Foto belum terdeteksi rincian biayanya");
            const fallbackReply = `ℹ️ Foto struk/transfer diterima, namun rincian item/nominal belum terdeteksi otomatis.\n\nSilakan ketik rinciannya di grup ya (contoh:\n*Alpukat 0,740kg 16rb*\n*Mangga 0,850kg 10rb*).`;
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
    const parts = [];
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: imageMime || "image/jpeg",
          data: imageBase64
        }
      });
    }
    if (text) {
      parts.push({ text: `Pesan chat pengeluaran: "${text}"` });
    } else {
      parts.push({ text: "Analisis foto bukti transfer, struk nota belanja pasar/supermarket, atau screenshot pesanan Shopee/Tokopedia ini. Baca semua rincian barang yang dibeli (nama barang, qty, dan nominal rupiah masing-masing item)." });
    }

    const prompt = `Kamu adalah asisten keuangan untuk outlet makanan sehat bernama 'Hungreens' di Indonesia.
Tugasmu: Analisis apakah pesan/foto ini merupakan laporan pengeluaran, nota belanja (pasar/toko), screenshot pesanan Shopee/Tokopedia, atau bukti transfer operasional.

Aturan Kategori:
- OPEX: Bahan baku makanan/minuman (buah, sayur, ayam, daging, ikan, bumbu/saus, minyak, beras, rice paper, keju, chia seed, susu) dan kemasan makanan (plastik kresek, lunch box, cup salad, tutup, paper bag, sedotan).
- CAPEX: Kebutuhan operasional outlet non-makanan (listrik/token PLN, air/PDAM, gas elpiji, galon air minum, wifi/internet, sabun pel, pembersih dapur, tisu, cetak stiker logo, spanduk, perlengkapan toko/alat dapur).
- Jika HANYA obrolan biasa, pertanyaan, sapaan, atau diskusi yang bukan biaya -> set isExpense: false.

PENTING - CATAT PER ITEM TERPISAH:
- Jika di nota/chat/screenshot Shopee terdapat beberapa barang berbeda (misalnya: Alpukat, Mangga, Anggur, Semangka), CATAT SETIAP BARANG SEBAGAI OBJEK TERPISAH dalam array "items". JANGAN DIGABUNG menjadi satu total.
- Jika ada ongkos kirim atau biaya admin di Shopee, masukkan sebagai item tersendiri (misal: item "Ongkir Shopee", total: nominal ongkir).
- Pastikan setiap nominal adalah angka murni rupiah tanpa titik atau koma (misal: 16000, 10000, 20000).

Kembalikan format JSON persis seperti ini (hanya JSON murni, tanpa markdown backtick):
{
  "isExpense": true,
  "items": [
    {
      "category": "OPEX" atau "CAPEX",
      "item": "nama barang",
      "qty": "jumlah jika ada (contoh: 0,740 kg 3 pc, 2 kg, 1 pak)",
      "total": 16000,
      "ket": "keterangan toko / supplier (contoh: BB Buah, Shopee, Toko Plastik)"
    }
  ]
}`;

    parts.unshift({ text: prompt });

    // Model resmi Google Gemini Flash
    const candidateModels = [
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.0-flash",
      "gemini-2.5-flash"
    ];

    for (const mName of candidateModels) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${apiKey}`;
        
        let res = null;
        let data = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          res = await fetch(endpoint, {
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
          data = await res.json();
          if (res.status === 503 && attempt === 0) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          break;
        }

        if (res.ok && !data.error) {
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = cleanAndParseJSON(rawText);
            if (parsed && parsed.isExpense) {
              let items = [];
              if (Array.isArray(parsed.items) && parsed.items.length > 0) {
                items = parsed.items.filter(it => it && typeof it.total === "number" && it.total > 0);
              } else if (typeof parsed.total === "number" && parsed.total > 0) {
                items = [{
                  category: parsed.category || "OPEX",
                  item: parsed.item || "Pengeluaran",
                  qty: parsed.qty || "",
                  total: parsed.total,
                  ket: parsed.ket || ""
                }];
              }
              if (items.length > 0) {
                addLog("AI SUCCESS", `Berhasil dianalisis oleh [${mName}]: ${items.length} item terdeteksi`);
                return { isExpense: true, items: items };
              }
            }
          }
        } else {
          addLog("AI RETRY", `Model ${mName} (${res?.status}): ${data?.error?.message?.substring(0, 80) || "error"}`);
        }
      } catch (err) {
        addLog("AI RETRY", `Model ${mName} err: ${err.message}`);
      }
    }
  }

  // Fallback cerdas jika AI offline atau jika teks manual
  return parseExpenseFallback(text);
}

function parseSingleLine(line) {
  if (!line) return null;
  const clean = line.trim();
  if (clean.length < 3) return null;

  // Cari nominal harga:
  // 1) Rp / rp. 50.000 atau Rp50000
  // 2) Angka bertitik ribuan: 50.000, 697.440
  // 3) Angka + rb / k / ribu: 16ribu, 50rb, 28k
  // 4) Angka murni 4-8 digit (1000 - 99999999): 12000, 25000
  const priceRegex = /(?:rp\.?\s*(\d{1,3}(?:[.,]\d{3})*|\d+)|\b(\d{1,3}(?:[.,]\d{3})+)\b|\b(\d+)\s*(rb|k|ribu)\b(?!\w)|\b(\d{4,8})\b)/i;
  const priceMatch = clean.match(priceRegex);
  if (!priceMatch) return null;

  const fullPriceStr = priceMatch[0];
  let rawNum = priceMatch[1] || priceMatch[2] || priceMatch[3] || priceMatch[5];
  const unit = (priceMatch[4] || "").toLowerCase();

  rawNum = (rawNum || "").replace(/[.,]/g, "");
  let total = parseInt(rawNum, 10);
  if (unit === "rb" || unit === "k" || unit === "ribu") {
    total *= 1000;
  }

  if (isNaN(total) || total < 1000) return null;

  let rem = clean.replace(fullPriceStr, "").trim();

  // Cari Quantity (contoh: 0,740kg, 1kg, 5pcs, 2 pak, 3pc, 1 pc, 2L, 500gr)
  const qtyRegex = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gram|ons|pcs|pc|pak|dus|btl|botol|ikat|iket|sisir|kaleng|butir|sak|roll|lembar|l|liter)\b/gi;
  const qtyMatches = rem.match(qtyRegex);
  const qtyStr = qtyMatches ? qtyMatches.join(" ") : "";

  let item = rem;
  if (qtyMatches) {
    for (const q of qtyMatches) {
      item = item.replace(q, "");
    }
  }
  item = item.replace(/\b(beli|bayar|tadi|untuk)\b/gi, "").replace(/^[,\s.-]+|[,\s.-]+$/g, "").trim();
  if (!item || item.length > 50) item = "Belanja Bahan";

  const capexKeywords = ["gas", "elpiji", "galon", "token", "pln", "listrik", "air", "pdam", "wifi", "indosat", "sabun", "pel", "tisu", "stiker", "sarung tangan", "kresek"];
  const isCapex = capexKeywords.some(k => item.toLowerCase().includes(k));

  return {
    category: isCapex ? "CAPEX" : "OPEX",
    item: item.charAt(0).toUpperCase() + item.slice(1),
    qty: qtyStr,
    total: total,
    ket: ""
  };
}

function parseExpenseFallback(text) {
  if (!text) return { isExpense: false, items: [] };

  if (text.startsWith("✅") || text.startsWith("ℹ️") || text.startsWith("⚠️") || text.includes("*Tercatat ke [") || text.includes("contoh:")) {
    return { isExpense: false, items: [] };
  }

  // Pisahkan baris baru atau koma pemisah item (hindari memecah koma desimal seperti 0,740kg)
  const lines = text.split(/(?:\r?\n|,(?!\d))/).map(s => s.trim()).filter(Boolean);
  const items = [];

  for (const line of lines) {
    const parsed = parseSingleLine(line);
    if (parsed) items.push(parsed);
  }

  if (items.length === 0) return { isExpense: false, items: [] };

  return {
    isExpense: true,
    items: items
  };
}

function getWeekTabName(dateNum) {
  if (dateNum >= 1 && dateNum <= 7) return "MINGGU 1";
  if (dateNum >= 8 && dateNum <= 14) return "MINGGU 2";
  if (dateNum >= 15 && dateNum <= 21) return "MINGGU 3";
  if (dateNum >= 22 && dateNum <= 28) return "MINGGU 4";
  return "MINGGU 5";
}

startWhatsAppBot();
