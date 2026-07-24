// Netlify serverless function: /.netlify/functions/submissions
// Stores generated prequalification summaries in Netlify Blobs, keyed by
// insured name + timestamp, and auto-expires anything older than 30 days.

const { getStore, connectLambda } = require("@netlify/blobs");

const STORE_NAME = "livery-prequalifications";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function slugify(name) {
  return (name || "untitled")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

exports.handler = async (event) => {
  // Required when a function is invoked outside the native Netlify runtime
  // (e.g. AWS Lambda compatibility mode); harmless no-op otherwise.
  try { connectLambda(event); } catch (e) { /* already connected / not needed */ }

  const store = getStore(STORE_NAME);

  try {
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { name, summaryText, docTypes } = body;

      if (!name || !summaryText) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing 'name' or 'summaryText'." }) };
      }

      const savedAt = Date.now();
      const id = `${slugify(name)}--${savedAt}`;

      await store.setJSON(id, {
        id,
        name: name.toString().trim(),
        summaryText,
        docTypes: Array.isArray(docTypes) ? docTypes : [],
        savedAt
      });

      return { statusCode: 200, body: JSON.stringify({ id, savedAt }) };
    }

    if (event.httpMethod === "GET") {
      const { blobs } = await store.list();
      const now = Date.now();
      const results = [];

      for (const b of blobs) {
        const record = await store.get(b.key, { type: "json" });
        if (!record) continue;

        if (now - record.savedAt > THIRTY_DAYS_MS) {
          // Housekeeping: quietly clean up anything past the 30-day window.
          await store.delete(b.key);
          continue;
        }
        results.push(record);
      }

      results.sort((a, b) => b.savedAt - a.savedAt);
      return { statusCode: 200, body: JSON.stringify({ items: results }) };
    }

    if (event.httpMethod === "DELETE") {
      const id = (event.queryStringParameters || {}).id;
      if (!id) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing 'id' query parameter." }) };
      }
      await store.delete(id);
      return { statusCode: 200, body: JSON.stringify({ deleted: id }) };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err && err.message ? err.message : err) })
    };
  }
};
