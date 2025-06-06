// api/getSignals.js
// ------------------------------
// Vercel Serverless Function: retrieve and clear all signaling messages for a room.
// ------------------------------

import { kv } from "@vercel/kv";

/**
 * Expects a GET request with query params:
 *   GET /api/getSignals?roomId=ROOMID
 *
 * Returns:
 *   { signals: [ { fromPeer, type, data, timestamp }, ... ] }
 *
 * Then clears the list from KV, so those signals are not delivered again.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Only GET is allowed" });
    return;
  }

  try {
    const roomId = req.query.roomId;
    if (!roomId) {
      throw new Error("Missing roomId");
    }

    const key = `signals:${roomId}`;

    // Fetch all items (0..-1 means entire list, most recent first)
    const rawList = await kv.lrange(key, 0, -1); // returns array of JSON strings

    if (rawList.length === 0) {
      // Nothing to deliver
      res.status(200).json({ signals: [] });
      return;
    }

    // Parse each JSON string
    const envelopes = rawList
      .map((str) => {
        try {
          return JSON.parse(str);
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null);

    // Clear the list so no one else gets duplicates
    await kv.del(key);

    res.status(200).json({ signals: envelopes });
  } catch (err) {
    console.error("getSignals error:", err);
    res.status(400).json({ error: err.message, signals: [] });
  }
}
