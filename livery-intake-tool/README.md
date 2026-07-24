# Livery Submission Intake Tool

A small web tool: upload a Quick Quote Sheet, Application, MVRs, and Loss Runs
for a livery submission, and it generates the formatted intake email your
team uses — following the rules you've been refining:

- New venture → effective date is set to the next calendar day, not a date pulled from the docs
- Driver experience shown with the MVR issue date alongside it
- MVR issue date under 3 years → red flag line requiring proof of driver's license
- Vehicle line shows model, VIN, and fuel type (Gas/Hybrid/Electric)
- Loss Summary is a brief "Yes, losses listed" / "No losses listed"
- Operations is always listed as "Livery" (Uber/Lyft counted as Livery)

Generated summaries can be **saved by insured name and are kept for 30 days**,
so the team can come back to a prequalification without re-uploading and
re-running it. Anything older than 30 days is cleaned up automatically.

## How it works

- **Generating a summary**: a Netlify serverless function
  (`netlify/functions/extract.js`) sends your uploaded documents straight to
  the Anthropic API (Claude) and asks it to extract the fields and fill in
  the template — the same way this was done in chat, just automated.
  - PDFs and images are sent to Claude directly (no OCR step needed — Claude reads them natively).
  - Spreadsheets (.xlsx) are converted to a text dump in the browser before sending.
- **Saving / loading / deleting**: a second function
  (`netlify/functions/submissions.js`) stores saved summaries in
  [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) —
  Netlify's built-in key-value store. No database to set up; it works out of
  the box once the site is deployed on Netlify. Records older than 30 days
  are deleted automatically the next time the list is loaded.

## Deploying to Netlify

1. **Get an Anthropic API key** (if you don't already have one) at
   [console.anthropic.com](https://console.anthropic.com/) → Settings → API Keys.

2. **Upload this folder to Netlify.** Easiest path:
   - Go to [app.netlify.com](https://app.netlify.com/) → "Add new site" → "Deploy manually"
   - Drag this whole folder onto the upload area
   - Netlify will publish the site and detect the function automatically

   (Or, if you prefer Git: push this folder to a GitHub repo and connect it
   in Netlify as a new site from Git — same result, plus auto-deploys on push.)

3. **Set your API key as an environment variable** (this keeps it off the
   client — nobody using the tool ever sees your key):
   - In your Netlify site, go to **Site configuration → Environment variables**
   - Add a variable named `ANTHROPIC_API_KEY` with your key as the value
   - Redeploy the site (Site overview → "Trigger deploy" → "Deploy site") so the function picks it up

4. Open your site's URL — you should see the intake tool. Try it with a test
   submission.

## Dependencies

This project uses one npm package, `@netlify/blobs`, for the save/load
feature. It's already installed in `node_modules` and included in the
folder/zip, so **drag-and-drop deploy works with no build step required.**
If you instead connect this as a Git repo in Netlify, that's fine too —
Netlify will run its own install, and either way works.

## Notes & limits

- **Cost**: every "Generate" click makes one Anthropic API call, billed to
  whichever API key you configured. Keep an eye on usage at
  console.anthropic.com if you share this link widely.
- **File size**: Netlify functions have a request size limit (~6MB total).
  Very large PDF scans or many files at once may exceed this — if you hit
  errors on a big batch, try splitting the upload into two runs.
- **Access control**: this site is public to anyone with the URL by default.
  If you want to restrict who can use it, Netlify's paid plans offer
  password protection (Site configuration → Visitor access), or you can add
  Netlify Identity for team logins.
- **Model**: the function currently calls `claude-sonnet-5`. You can change
  this in `netlify/functions/extract.js` (the `MODEL` constant) if you want
  to use a different Claude model.
- **Always review the output** before sending — this automates the
  extraction and formatting, but it's not a substitute for an underwriter's
  read of the actual documents.

## Updating the rules later

All the formatting logic and business rules live in the `SYSTEM_PROMPT` in
`netlify/functions/extract.js`. To change the template, add a new rule, or
adjust how a field is derived, edit the numbered rules there and redeploy.
