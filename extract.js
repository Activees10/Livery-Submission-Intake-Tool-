// Netlify serverless function: /.netlify/functions/extract
// Receives uploaded submission documents (already read client-side) and
// calls the Anthropic API to pull the required fields and format the
// underwriter's intake email, following the team's locked-in formatting rules.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = (todayDate) => `You are an insurance submission-intake assistant for a commercial auto LIVERY underwriting team. You will be given the contents of a livery insurance submission package: some combination of a Commercial Auto Quick Quote Sheet, an insurance Application (e.g. an Applied Underwriters-style form), one or more driver MVR (motor vehicle record) reports, and one or more Loss Run reports from carriers/TPAs.

Read every document provided carefully, then respond with ONLY the filled-in template below. No preamble, no closing remarks, no markdown code fences — just the plain text of the completed template.

===== TEMPLATE (fill in every bracketed part, then remove the brackets) =====
Hello,

List new venture or effective date: [see RULE 1]

How many years' experience does the driver have? [X years] (MVR issue date: [MM/DD/YYYY])
[see RULE 3 for an optional red-flag line here]

Vehicle model, VIN, and fuel type:
[Year Make Model, VIN [VIN] — Gas/Hybrid/Electric]

Please see attached submission for the above. Seeking APD Coverage. Details of risk as follows.

State: [2-letter state]
APD TIV: [$amount, or "Not stated in submission — confirm with insured" if it cannot be found anywhere]
Deductible: [$amount]
Docs: [comma-separated list of the document types actually provided]
Notes: [brief notes only if genuinely useful — date discrepancies between documents, missing TIV, unusual exposures, open claims detail, etc. Leave this line blank (just "Notes:") if there is nothing notable.]

Loss Summary: [see RULE 5]

Operations: Livery
===== END TEMPLATE =====

RULES (follow exactly):

1. NEW VENTURE / EFFECTIVE DATE: If the submission indicates this is a brand-new venture (e.g. "years in business: NEW", "Is this a new venture?" = Y, no prior carrier/policy, no loss history to report because there is no prior coverage), then the effective date is the day AFTER today's date, not any date found in the documents. Today's date is ${todayDate} (MM/DD/YYYY). Compute the next calendar day yourself and format the line as: "New venture – effective MM/DD/YYYY". If it is NOT a new venture, use the effective/renewal date found in the documents and format the line as just "MM/DD/YYYY" (do not use the word "Renewal").

2. DRIVER EXPERIENCE: State the driver's years of experience as given on the quick quote sheet, application, or driver schedule if stated there. If not stated anywhere, estimate from the MVR's "Approx. Year Lic. First Issued" field and clearly label it as an estimate (e.g. "approx. 8 years (estimated from MVR)"). Always include the MVR's Issue Date in parentheses after the experience, in MM/DD/YYYY format, exactly as shown: "X years (MVR issue date: MM/DD/YYYY)".

3. MVR RED-FLAG LINE: If the MVR issue date is LESS than 3 years before today's date (${todayDate}), add this exact sentence on its own line directly under the experience line, wrapped in <RED></RED> tags so the client can style it: <RED>MVR issue date is under 3 years — proof of driver's license required.</RED> If the MVR issue date is 3 or more years before today, omit this line entirely (no blank line either).

4. VEHICLE LINE: Format exactly as: "[Year] [Make] [Model], VIN [VIN] — [Gas/Hybrid/Electric]" on its own line below the question line. Determine the fuel type using your own knowledge of that specific make/model/trim unless a document explicitly states it. If there are multiple vehicles, list each on its own line in this same format.

5. LOSS SUMMARY: Must be EXACTLY the phrase "Yes, losses listed" if ANY claim/loss appears in ANY loss run document provided (open, closed, $0 incurred, doesn't matter — if a claim record exists, it counts). Otherwise must be EXACTLY "No losses listed". If this is a new venture with no loss runs applicable, use "No loss runs submitted (new venture)".

6. OPERATIONS: Always output "Livery" on this line. This includes standard livery/black car/limousine work AND any Uber/Lyft/rideshare component found in the documents — the team treats rideshare as Livery for their purposes, so never flag it as a mismatch or note it as an exception.

7. NOTES: Keep brief. Only include genuinely useful flags — e.g. mismatched dates between documents, a policy-period discrepancy, missing TIV, an open claim worth calling out, unusual exposures (alcohol on board, subcontracted vehicles, etc). If there's nothing worth flagging, leave the line as just "Notes:" with nothing after it.

8. APD TIV: If not explicitly stated anywhere (quick quote sheet "Physical Damage Limit", application "Total Stated Values" / vehicle "Stated Amount", etc.), say "Not stated in submission — confirm with insured" and add a corresponding note.

9. Never fabricate data. If a field truly cannot be determined from the documents, say "Not stated in submission" for that field rather than guessing a specific value (fuel type and experience estimates per Rules 2 and 4 are the only allowed inferences, and both must be clearly grounded in what you were given).

10. If multiple drivers or vehicles are present, still follow the single-template structure but list every driver's experience line and every vehicle line, each on its own line, in the same order as they appear in the documents.
`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error:
          "Server is not configured. Set the ANTHROPIC_API_KEY environment variable in your Netlify site settings (Site configuration > Environment variables) and redeploy."
      })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const { today, files } = payload;

  if (!today || !Array.isArray(files) || files.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'today' date or 'files' array." })
    };
  }

  // Build the Anthropic content blocks from the uploaded files.
  const contentBlocks = [];
  for (const f of files) {
    if (!f || !f.kind) continue;
    if (f.kind === "document") {
      contentBlocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: f.media_type || "application/pdf",
          data: f.data
        }
      });
    } else if (f.kind === "image") {
      contentBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: f.media_type || "image/png",
          data: f.data
        }
      });
    } else if (f.kind === "text") {
      contentBlocks.push({
        type: "text",
        text: `----- Extracted from spreadsheet file "${f.name}" -----\n${f.data}\n----- end of "${f.name}" -----`
      });
    }
  }

  contentBlocks.push({
    type: "text",
    text: `Today's date is ${today}. Please extract the required fields from the documents above and return the completed template exactly as instructed.`
  });

  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1600,
        system: SYSTEM_PROMPT(today),
        messages: [
          {
            role: "user",
            content: contentBlocks
          }
        ]
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({
          error: data?.error?.message || "Anthropic API request failed."
        })
      };
    }

    const textBlocks = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      statusCode: 200,
      body: JSON.stringify({ result: textBlocks })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err && err.message ? err.message : err) })
    };
  }
};
