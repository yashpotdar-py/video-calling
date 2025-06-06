// api/sendSignal.js
// ------------------------------
// Vercel Serverless Function: accept a signaling message and push it into Vercel KV list.
// ------------------------------

import { kv } from "@vercel/kv";

/**
 * Expects a POST request with JSON body:
 * {
 *   roomId: string,
 *   fromPeer: string,
 *   type: 'join' | 'offer' | 'answer' | 'ice-candidate',
 *   data: any
 * }
 *
 * Stores the message in a KV list under key `signals:{roomId}`.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST is allowed" });
    return;
  }

  try {
    const { roomId, fromPeer, type, data } = req.body;
    if (!roomId || !fromPeer || !type || data === undefined) {
      throw new Error("Missing one of {roomId, fromPeer, type, data}");
    }

    // Construct a small envelope
    const envelope = {
      fromPeer,
      type,
      data,
      timestamp: Date.now(),
    };

    // Push into a Redis list: key = `signals:{roomId}`
    await kv.lpush(`signals:${roomId}`, JSON.stringify(envelope));

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("sendSignal error:", err);
    res.status(400).json({ error: err.message });
  }
}
