export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const order = req.body;
    if (!order || !order.note_attributes) {
      return res.status(200).send("No note attributes");
    }

    // note_attributes array ko object me convert
    const notes = {};
    order.note_attributes.forEach((item) => {
      notes[item.name.toLowerCase()] = item.value;
    });

    const fullText = `
Customer Name: ${notes["name"] || ""}
Phone: ${notes["phone"] || ""}

Address: ${notes["address"] || ""}
City: ${notes["city"] || ""}
State: ${notes["state"] || ""}
PIN Code: ${notes["pin code"] || ""}
Country: India
`;

    // Google Translate
    const translateRes = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: fullText,
          target: "en",
        }),
      }
    );

    const data = await translateRes.json();
    const translatedText = data.data.translations[0].translatedText;

    // Shopify Order Note update
    await fetch(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2026-01/orders/${order.id}.json`,
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order: {
            id: order.id,
            note: `--- AUTO TRANSLATED (ENGLISH) ---\n\n${translatedText}`,
          },
        }),
      }
    );

    return res.status(200).send("Order translated successfully");
  } catch (err) {
    console.error(err);
    return res.status(200).send("Error handled safely");
  }
}
