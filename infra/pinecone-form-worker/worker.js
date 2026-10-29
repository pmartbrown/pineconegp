// Pinecone Capital investor access form -> email to admin@pineconegp.com
// Route: pineconegp.com/api/contact (and www). Uses the Cloudflare Email Routing send_email binding.
import { EmailMessage } from "cloudflare:email";

const ALLOWED_ORIGINS = ["https://pineconegp.com", "https://www.pineconegp.com"];
const FROM = "forms@mail.pineconegp.com";
const FROM_NAME = "Pinecone Capital website";
const TO = "admin@pineconegp.com";

// Allowed answers for the tap fields; anything else is stored as "(invalid)".
const CHOICES = {
  accredited: ["Yes", "No"],
  us_person: ["Yes", "No"],
  investor_type: ["Individual", "Entity"],
  heard_from: ["A personal introduction", "Real Quick Funds", "Funding Hub", "Social media", "Event or presentation", "Other"],
  interest: ["Income", "Growth"],
};

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(origin ? cors(origin) : {}) },
  });
}

// Single-line clean: strip CR/LF and control chars, collapse spaces, cap length.
function line(v, max) {
  return String(v ?? "").replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Multi-line clean for the free-text message: normalise newlines, strip other control chars, cap length.
function multi(v, max) {
  return String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function choice(key, v) {
  const s = line(v, 60);
  return CHOICES[key].includes(s) ? s : "(invalid)";
}

const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, "$&\r\n");

function buildMime({ subject, replyTo, replyName, text }) {
  const headers = [
    `From: ${encWord(FROM_NAME)} <${FROM}>`,
    `To: <${TO}>`,
    `Reply-To: ${replyName ? `"${encWord(replyName.replace(/"/g, ""))}" ` : ""}<${replyTo}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@mail.pineconegp.com>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + wrap76(b64(text));
}

export default {
  async fetch(request, env) {
    // Only /api/contact is a real endpoint. The infra/* routes exist so the worker source
    // in the repo (infra/) is never served by GitHub Pages through the custom domain.
    if (new URL(request.url).pathname !== "/api/contact") return new Response("Not found", { status: 404 });
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);

    if (request.method === "OPTIONS") {
      return allowed ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    }
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405, allowed ? origin : null);
    if (!allowed) return json({ ok: false, error: "origin" }, 403, null);
    if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
      return json({ ok: false, error: "content-type" }, 415, origin);
    }

    const raw = await request.text();
    if (raw.length > 20000) return json({ ok: false, error: "too large" }, 413, origin);
    let d;
    try { d = JSON.parse(raw); } catch { return json({ ok: false, error: "bad json" }, 400, origin); }
    if (!d || typeof d !== "object") return json({ ok: false, error: "bad json" }, 400, origin);

    // Honeypot: bots fill "company". Pretend success, send nothing.
    if (line(d.company, 200)) return json({ ok: true }, 200, origin);

    const name = line(d.name, 120);
    const email = line(d.email, 200).toLowerCase();
    const phone = line(d.phone, 40);
    const errors = [];
    if (name.length < 2) errors.push("name");
    if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) errors.push("email");
    if (phone.replace(/\D/g, "").length < 10) errors.push("phone");
    if (errors.length) return json({ ok: false, error: "invalid", fields: errors }, 400, origin);

    const a = {
      accredited: choice("accredited", d.accredited),
      us_person: choice("us_person", d.us_person),
      investor_type: choice("investor_type", d.investor_type),
      heard_from: choice("heard_from", d.heard_from),
      interest: choice("interest", d.interest),
    };
    const message = multi(d.message, 1000);
    const page = line(d.page, 300);
    const now = new Date();
    const mt = now.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });

    const text = [
      "New investor access request from pineconegp.com",
      "",
      `Name:              ${name}`,
      `Email:             ${email}`,
      `Phone:             ${phone}`,
      "",
      `Accredited:        ${a.accredited}`,
      `US person:         ${a.us_person}`,
      `Invests as:        ${a.investor_type}`,
      `Heard about us:    ${a.heard_from}`,
      `Income or growth:  ${a.interest}`,
      "",
      "Anything else:",
      message || "(nothing added)",
      "",
      "Acknowledged: this is a request to start a conversation, not an offer to buy or sell any security.",
      "",
      `Submitted: ${mt} MT (${now.toISOString()})`,
      `Page: ${page || "-"}`,
      `Country (Cloudflare): ${request.cf?.country || "-"}`,
      "",
      "Reply to this email to answer the visitor directly.",
    ].join("\n");

    try {
      const mime = buildMime({ subject: `Investor access request: ${name}`, replyTo: email, replyName: name, text });
      await env.SEND_EMAIL.send(new EmailMessage(FROM, TO, mime));
    } catch (err) {
      console.error("send_email failed", err && err.message);
      return json({ ok: false, error: "send" }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  },
};
