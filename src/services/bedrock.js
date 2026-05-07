const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const cfg = require('../config');

const client = new BedrockRuntimeClient({
  region: cfg.AWS_REGION,
  credentials: {
    accessKeyId: cfg.AWS_ACCESS_KEY_ID,
    secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
  },
});

const VISION_PROMPT = `You are analyzing a meal photo for a calorie journal.

Return ONLY valid JSON, no prose, no markdown fences. Schema:
{
  "foods": [{"name": "<food>", "portion": "<like '1 cup' or '~150g'>", "kcal": <int>}],
  "kcal_total": <int>,
  "protein_g": <int>,
  "carbs_g": <int>,
  "fat_g": <int>,
  "confidence": "<low|medium|high>",
  "observation": "<one-sentence neutral comment about the meal's macro balance, never prescriptive, max 120 chars>"
}

Rules:
- Estimate portions visually. Be realistic, not generous.
- If the image is unclear or not food, set confidence="low" and kcal_total=0 with foods=[].
- observation: factual ("balanced mix of protein and carbs") not prescriptive ("you should eat...").
- Never give medical or weight-loss advice.`;

const TEXT_PROMPT = `You are estimating calories for a meal described in text for a calorie journal.

Return ONLY valid JSON. Schema same as photo analysis:
{"foods":[{"name":"...","portion":"...","kcal":INT}],"kcal_total":INT,"protein_g":INT,"carbs_g":INT,"fat_g":INT,"confidence":"low|medium|high","observation":"<one neutral sentence>"}

Rules:
- Use typical portion sizes if not specified.
- observation must be factual and brief (max 120 chars), never prescriptive.`;

function safeParse(text) {
  // Strip code fences and find first {...} block.
  const s = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function defaultsFor(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    foods: Array.isArray(parsed.foods) ? parsed.foods.slice(0, 12).map(f => ({
      name: String(f.name || 'item').slice(0, 60),
      portion: String(f.portion || '').slice(0, 40),
      kcal: Math.max(0, parseInt(f.kcal, 10) || 0),
    })) : [],
    kcal_total: Math.max(0, parseInt(parsed.kcal_total, 10) || 0),
    protein_g: Math.max(0, parseInt(parsed.protein_g, 10) || 0),
    carbs_g: Math.max(0, parseInt(parsed.carbs_g, 10) || 0),
    fat_g: Math.max(0, parseInt(parsed.fat_g, 10) || 0),
    confidence: ['low','medium','high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    observation: String(parsed.observation || '').slice(0, 200),
  };
}

async function invokeHaiku(messages) {
  const cmd = new InvokeModelCommand({
    modelId: cfg.BEDROCK_HAIKU_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      messages,
    }),
  });
  const result = await client.send(cmd);
  const body = JSON.parse(Buffer.from(result.body).toString());
  return body.content?.[0]?.text || '';
}

async function analyzeMealPhoto(imageBuffer, mediaType = 'image/jpeg') {
  const text = await invokeHaiku([{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
      { type: 'text', text: VISION_PROMPT },
    ],
  }]);
  return defaultsFor(safeParse(text));
}

async function analyzeMealText(description) {
  const text = await invokeHaiku([{
    role: 'user',
    content: [{ type: 'text', text: `${TEXT_PROMPT}\n\nMeal description: ${description}` }],
  }]);
  return defaultsFor(safeParse(text));
}

module.exports = { analyzeMealPhoto, analyzeMealText };
