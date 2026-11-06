import makeWASocket, { 
  useMultiFileAuthState, 
  DisconnectReason 
} from "@whiskeysockets/baileys";
import express from "express";
import QRCode from "qrcode";
import pino from "pino";

// ===================================================================
// KONFIGURASI BOT HUNGREENS CLOUD 24 JAM
// ===================================================================

const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://script.google.com/macros/s/AKfycby4nFJRKzBxY89IinlxSwgakwVSC-wlRMXqvL_71JgXQZajrV_orVXnYdP-b_RBdj5HFg/exec";
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
        <title>Bot Absensi Hungreens</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, sans-serif; text-align: center; padding: 40px 20px; background: #f8fafc; color: #1e293b; }
          .card { max-width: 450px; margin: 0 auto; background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
          .badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; margin-bottom: 20px; }
          .badge-online { background: #dcfce7; color: #15803d; }
          .badge-wait { background: #fef3c7; color: #b45309; }
          .btn { display: inline-block; padding: 10px 20px; background: #0284c7; color: white; text-decoration: none; border-radius: 8px; font-weight: 500; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>🥗 Hungreens Attendance Bot</h2>
          ${isConnected 
            ? `<div class="badge badge-online">● Bot Aktif & Terhubung ke WhatsApp</div><p>Semua shareloc karyawan akan otomatis masuk ke Google Sheets.</p>` 
            : `<div class="badge badge-wait">⏳ Perlu Scan WhatsApp</div><p><a class="btn" href="/qr">Buka Halaman Scan QR Code</a></p>`
          }
          <hr style="border:0; border-top:1px solid #e2e8f0; margin:20px 0;">
          <p style="font-size:12px; color:#64748b;">Status Terakhir: ${lastLog}</p>
        </div>
      </body>
    </html>
  `);
});

app.get("/qr", (req, res) => {
  if (isConnected) {
    return res.redirect("/");
  }

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
          <p style="font-size: 11px; color: #94a3b8; margin-top: 15px;">Halaman ini otomatis me-refresh setiap 5 detik.</p>
        </div>
      </body>
    </html>
  `);
});

app.get("/ping", (req, res) => {
  res.send("PONG - Bot Awake!");
});

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
      console.log("👉 QR Code baru siap di web browser.");
    }

    if (connection === "close") {
      isConnected = false;
      currentQRDataURL = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      lastLog = `Koneksi terputus (status: ${statusCode}). Reconnecting: ${shouldReconnect}`;
      console.log(lastLog);
      if (shouldReconnect) {
        startWhatsAppBot();
      }
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
      if (!msg.message || msg.key.fromMe) return;

      const isGroup = msg.key.remoteJid.endsWith("@g.us");
      if (!isGroup) return; // Hanya proses di dalam grup WhatsApp

      const messageContent = msg.message;
      const isLocation = messageContent.locationMessage || messageContent.liveLocationMessage;
      if (!isLocation) return; // Abaikan jika bukan shareloc

      const senderJid = msg.key.participant || msg.key.remoteJid;
      const cleanPhone = senderJid.replace(/@.+/, "").replace(/\D/g, "");
      
      const pushName = msg.pushName || "Karyawan";
      const employeeName = EMPLOYEE_MAP[cleanPhone] || pushName;

      const timestampSeconds = msg.messageTimestamp;
      const dateObj = new Date(Number(timestampSeconds) * 1000);

      const formatterTime = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const timeStr = formatterTime.format(dateObj).replace(".", ":");

      const formatterDay = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        weekday: "long"
      });
      const dayName = formatterDay.format(dateObj).toUpperCase();

      const formatterDate = new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Jakarta",
        day: "numeric"
      });
      const dateNum = parseInt(formatterDate.format(dateObj), 10);

      console.log(`\n📍 Shareloc Diterima: ${employeeName} (${cleanPhone})`);
      console.log(`⏰ Jam: ${timeStr} WIB (${dayName}, tgl ${dateNum})`);

      const payload = {
        name: employeeName,
        phone: cleanPhone,
        time: timeStr,
        dayName: dayName,
        dateNum: dateNum,
        timestamp: Number(timestampSeconds) * 1000
      };

      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      console.log("📊 Respon Spreadsheet:", result);

    } catch (err) {
      console.error("Error menangani pesan shareloc:", err);
    }
  });
}

startWhatsAppBot();
