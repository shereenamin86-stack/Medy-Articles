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

      // Convert Markdown to Rich Text
      let richText = await richTextFromMarkdown(markdown);

      // Fallback if conversion produces empty content
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

      console.log("Body field preview:", JSON.stringify(payload.body["en-GB"], null, 2));

      console.log("=== Syncing article ===");
      console.log("Title:", title);
      console.log("Payload preview:", JSON.stringify(payload, null, 2));

      try {
        // Check if entry already exists by slug
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
      } catch (err) {
        console.error("Error creating/updating entry for:", title);
        console.error("Payload sent:", JSON.stringify(payload, null, 2));
        if (err.response && err.response.data) {
          console.error("Contentful validation errors:", JSON.stringify(err.response.data, null, 2));
        } else {
          console.error(err);
        }
        // Continue to next file instead of crashing
        continue;
      }
    }

    console.log("=== All articles processed ===");

  } catch (err) {
    console.error("Fatal error during sync:", err);
    process.exit(1);
  }
}

// Catch unhandled rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

run();
