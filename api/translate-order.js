export default async function handler(req, res) {
  try {
    console.log("Webhook hit received from Shopify");

    return res.status(200).json({
      status: "Webhook received successfully",
      order_id: req.body?.id || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
