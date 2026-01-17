export default async function handler(req, res) {
  try {
    console.log("=== SHOPIFY ORDER RECEIVED ===");
    console.log(JSON.stringify(req.body, null, 2));

    return res.status(200).json({
      status: "Order received and logged",
      order_id: req.body?.id || null,
    });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
