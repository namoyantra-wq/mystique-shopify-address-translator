export default async function handler(req, res) {
  try {
    // Test ke liye sample Hindi address
    const hindiAddress =
      "मकान नंबर १२३, गली नंबर ४, शांति नगर, सेक्टर १५, गुडगाँव, हरियाणा - १२२००१, भारत";

    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: hindiAddress,
          target: "en",
        }),
      }
    );

    const data = await response.json();

    const translatedText =
      data.data.translations[0].translatedText;

    res.status(200).json({
      original: hindiAddress,
      translated: translatedText,
    });
  } catch (error) {
    res.status(500).json({
      error: "Translation failed",
      details: error.message,
    });
  }
}
