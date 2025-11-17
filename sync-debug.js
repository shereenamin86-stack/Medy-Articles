// sync-debug.js
const fs = require('fs');
const path = require('path');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');
const slugify = require('slugify');

const CONTENTFUL_SPACE_ID = process.env.CONTENTFUL_SPACE_ID;
const CONTENTFUL_ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT;
const CONTENTFUL_TOKEN = process.env.CONTENTFUL_TOKEN;

if (!CONTENTFUL_SPACE_ID || !CONTENTFUL_ENVIRONMENT || !CONTENTFUL_TOKEN) {
  console.error("ERROR: Missing Contentful environment variables.");
  process.exit(1);
}

const client = createClient({
  accessToken: CONTENTFUL_TOKEN
});

async function run() {
  try {
    const space = await client.getSpace(CONTENTFUL_SPACE_ID);
    const env = await space.getEnvironment(CONTENTFUL_ENVIRONMENT);

    const articlesDir = path.join(__dirname, 'articles');
    const files = fs.readdirSync(articlesDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(articlesDir, file);
      const markdown = fs.readFileSync(filePath, 'utf8');

      const title = path.basename(file, '.md');
      const slug = slugify(title, { lower: true });

      let richText = await richTextFromMarkdown(markdown);

      // Fallback if richText is empty
      if (!richText || !richText.content || richText.content.length === 0) {
        richText = {
          nodeType: 'document',
          data: {},
          content: [
            {
              nodeType: 'paragraph',
              data: {},
              content: [
                { nodeType: 'text', value: markdown, marks: [], data: {} }
              ]
            }
          ]
        };
      }

      const payload = {
        title: { "en-GB": title },
        slug: { "en-GB": slug },
        body: { "en-GB": richText }
      };

      console.log("Syncing article:", title);
      console.log("Payload preview:", JSON.stringify(payload, null, 2));

      // Check if entry already exists
      const existing = await env.getEntries({
        content_type: "article",
        "fields.slug": slug
      });

      let entry;
      if (existing.items.length > 0) {
        entry = existing.items[0];
        entry.fields = payload;
        await entry.update();
        console.log(`Updated existing entry: ${title}`);
      } else {
        entry = await env.createEntry("article", { fields: payload });
        console.log(`Created new entry: ${title}`);
      }

      await entry.publish();
      console.log(`Published entry: ${title}`);
    }
  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  }
}

run();
