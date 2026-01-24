// api/webhook.js
import axios from "axios";

function short(x) {
  try { return String(x).slice(0, 1000); } catch { return String(x); }
}

export default async function handler(req, res) {
  const start = Date.now();
  try {
    if (req.method !== "POST") {
      console.log("Method not allowed:", req.method);
      return res.status(405).json({ error: "Method not allowed" });
    }

    console.log(">>> Webhook invoked");
    const raw = short(JSON.stringify(req.body || {}).replace(/\n/g, " "));
    console.log(">>> Received payload (truncated):", raw);

    const SHOP = process.env.SHOPIFY_STORE;
    const TOKEN = process.env.SHOPIFY_TOKEN;
    const GOOGLE_KEY = process.env.GOOGLE_KEY;
    const SECRET = process.env.SHOPIFY_SECRET;

    console.log(">>> ENV presence -> SHOP:", !!SHOP, "TOKEN:", !!TOKEN, "GOOGLE_KEY:", !!GOOGLE_KEY, "SECRET:", !!SECRET);

    if (!SHOP || !TOKEN) {
      console.error("Missing SHOP or TOKEN env");
      return res.status(500).json({ error: "Missing SHOP or TOKEN env" });
    }

    const order = req.body || {};
    const orderId = order.id || order.order_id || null;
    console.log(">>> orderId:", orderId, "orderNumber:", order.order_number || order.name || null);

    // -------------------------
    // Collect which fields to translate (preserve originals)
    // -------------------------
    const fields = [];

    if (order.customer) {
      if (order.customer.first_name) fields.push(order.customer.first_name);
      if (order.customer.last_name) fields.push(order.customer.last_name);
    }

    if (order.shipping_address) {
      if (order.shipping_address.address1) fields.push(order.shipping_address.address1);
      if (order.shipping_address.address2) fields.push(order.shipping_address.address2);
      if (order.shipping_address.city) fields.push(order.shipping_address.city);
      if (order.shipping_address.province) fields.push(order.shipping_address.province);
      if (order.shipping_address.country) fields.push(order.shipping_address.country);
      if (order.shipping_address.company) fields.push(order.shipping_address.company);
    }

    if (order.billing_address) {
      if (order.billing_address.address1) fields.push(order.billing_address.address1);
      if (order.billing_address.address2) fields.push(order.billing_address.address2);
      if (order.billing_address.city) fields.push(order.billing_address.city);
      if (order.billing_address.province) fields.push(order.billing_address.province);
      if (order.billing_address.country) fields.push(order.billing_address.country);
      if (order.billing_address.company) fields.push(order.billing_address.company);
    }

    if (order.note) fields.push(order.note);

    // Remove duplicates while preserving order
    const uniqueFields = [];
    const seen = new Set();
    for (const f of fields) {
      const s = String(f || "").trim();
      if (!s) continue;
      if (!seen.has(s)) {
        seen.add(s);
        uniqueFields.push(f);
      }
    }

    if (uniqueFields.length === 0) {
      console.log("No translatable fields found — exiting");
      return res.status(200).json({ message: "No translatable fields" });
    }

    // --- GUARD: only proceed if at least one field contains Devanagari characters ---
    const hasDevanagari = uniqueFields.some(f => /[\u0900-\u097F]/.test(String(f || "")));
    if (!hasDevanagari) {
      console.log("No Devanagari text found in order fields — skipping translation to avoid overwriting English.");
      return res.status(200).json({ message: "Skipped: no Hindi text" });
    }

    // Translate using Google if key present
    let translated = uniqueFields.slice();
    if (!GOOGLE_KEY) {
      console.warn("GOOGLE_KEY missing — skipping translation (will still save originals)");
    } else {
      try {
        console.log("Calling Google Translate for", uniqueFields.length, "items");
        const resp = await axios.post(
          `https://translation.googleapis.com/language/translate/v2?key=${GOOGLE_KEY}`,
          { q: uniqueFields, target: "en" }
        );
        translated = resp.data.data.translations.map(t => t.translatedText);
        console.log("Translated result (truncated):", short(JSON.stringify(translated)));
      } catch (err) {
        console.error("Translate API error:", err?.response?.data || err.message || err);
        return res.status(500).json({ error: "Translate API failed", details: err?.response?.data || err.message });
      }
    }

    // Helper: post metafield
    async function postMetafield(orderIdToUse, namespace, key, value) {
      const url = `https://${SHOP}/admin/api/2025-10/orders/${orderIdToUse}/metafields.json`;
      const payload = { metafield: { namespace, key, value: String(value).slice(0, 250), type: "single_line_text_field" } };
      console.log("POST metafield ->", url, "payload key:", key);
      return axios.post(url, payload, { headers: { "X-Shopify-Access-Token": TOKEN } });
    }

    // If no order ID (Shopify test payloads), skip updates but return success
    if (!orderId) {
      console.warn("No order.id in payload; skipping metafield creation and order update");
      return res.status(200).json({ message: "No order.id in payload; skipped" });
    }

    // Save originals + translated as metafields
    for (let i = 0; i < uniqueFields.length; i++) {
      const orig = uniqueFields[i];
      const trans = translated[i] || orig;
      try {
        const r1 = await postMetafield(orderId, "original_text", `field_${i}`, orig);
        console.log("Saved original metafield", i, "status", r1.status);
      } catch (e) {
        console.error("Error saving original metafield", i, e?.response?.status, e?.response?.data || e.message);
      }
      try {
        const r2 = await postMetafield(orderId, "translated_text", `field_${i}`, trans);
        console.log("Saved translated metafield", i, "status", r2.status);
      } catch (e) {
        console.error("Error saving translated metafield", i, e?.response?.status, e?.response?.data || e.message);
      }
    }

    // Helper to map original => translated robustly
    function translatedFor(originalValue) {
      if (!originalValue) return null;
      const idx = uniqueFields.findIndex(f => String(f).trim() === String(originalValue).trim());
      if (idx === -1) return null;
      return (translated && typeof translated[idx] !== 'undefined') ? translated[idx] : null;
    }

    // Prepare order update using translatedFor(...) (order-level overwrite)
    try {
      const idToUse = (typeof orderId !== 'undefined' && orderId) ? orderId : (order && (order.id || order.order_id));
      if (!idToUse) {
        console.error("No order id available — skipping order update");
        return res.status(200).json({ message: "No order id; skipped update" });
      }

      const orderUpdate = { order: { id: idToUse } };

      // Build fullName from translated name fields if any
      let fullName = "";
      const tFirst = translatedFor(order.customer?.first_name) || null;
      const tLast  = translatedFor(order.customer?.last_name)  || null;
      if (tFirst) fullName += tFirst;
      if (tLast) fullName += (fullName ? " " : "") + tLast;

      // Shipping payload
      if (order.shipping_address) {
        const shipping_payload = {};
        const a1 = translatedFor(order.shipping_address.address1);
        const a2 = translatedFor(order.shipping_address.address2);
        const city = translatedFor(order.shipping_address.city);
        const prov = translatedFor(order.shipping_address.province);
        const country = translatedFor(order.shipping_address.country);
        const comp = translatedFor(order.shipping_address.company);

        if (a1) shipping_payload.address1 = a1;
        if (a2) shipping_payload.address2 = a2;
        if (city) shipping_payload.city = city;
        if (prov) shipping_payload.province = prov;
        if (country) shipping_payload.country = country;
        if (comp) shipping_payload.company = comp;
        if (fullName) shipping_payload.name = fullName;

        if (Object.keys(shipping_payload).length > 0) {
          shipping_payload.id = order.shipping_address.id || undefined;
          orderUpdate.order.shipping_address = shipping_payload;
        }
      }

      // Billing payload
      if (order.billing_address) {
        const billing_payload = {};
        const b_a1 = translatedFor(order.billing_address.address1);
        const b_a2 = translatedFor(order.billing_address.address2);
        const b_city = translatedFor(order.billing_address.city);
        const b_prov = translatedFor(order.billing_address.province);
        const b_country = translatedFor(order.billing_address.country);
        const b_comp = translatedFor(order.billing_address.company);

        if (b_a1) billing_payload.address1 = b_a1;
        if (b_a2) billing_payload.address2 = b_a2;
        if (b_city) billing_payload.city = b_city;
        if (b_prov) billing_payload.province = b_prov;
        if (b_country) billing_payload.country = b_country;
        if (b_comp) billing_payload.company = b_comp;
        if (fullName) billing_payload.name = fullName;

        if (Object.keys(billing_payload).length > 0) {
          billing_payload.id = order.billing_address.id || undefined;
          orderUpdate.order.billing_address = billing_payload;
        }
      }

      // Update order note if translated
      const noteTranslated = translatedFor(order.note);
      if (noteTranslated) {
        orderUpdate.order.note = noteTranslated;
      }

      // Only call update if something to change
      if (orderUpdate.order.shipping_address || orderUpdate.order.billing_address || orderUpdate.order.note) {
        console.log("Updating order with translated fields:", short(JSON.stringify(orderUpdate)));
        try {
          const updResp = await axios.put(
            `https://${SHOP}/admin/api/2025-10/orders/${idToUse}.json`,
            orderUpdate,
            { headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json" } }
          );
          console.log("Order updated with translated fields:", updResp.status);
        } catch (e) {
          console.error("Order update failed:", e?.response?.status, e?.response?.data || e.message);
        }
      } else {
        console.log("Nothing to update on order (no translated shipping/billing/name/note).");
      }

    } catch (e) {
      console.error("Error updating order with translated values:", e?.response?.status, e?.response?.data || e.message);
    }

    const elapsed = Date.now() - start;
    console.log("Finished processing webhook in", elapsed, "ms");
    return res.status(200).json({ message: "Processed & updated order", processedFields: uniqueFields.length });
  } catch (err) {
    console.error("Unhandled error:", err?.response?.data || err.message || err);
    return res.status(500).json({ error: "Server error", details: err?.response?.data || err.message });
  }
}
