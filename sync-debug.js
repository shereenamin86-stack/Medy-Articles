// sync-debug.js
const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');

// --- FULL ERROR LOGGING ---
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

async function run() {
  try {
    // Connect to Contentful
    const client = createClient({ accessToken: process.env.CONTENTFUL_TOKEN });
    const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
    const env = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT);

    console.log("Environment connected successfully.");

    const folder = "./articles";
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".md"));

    console.log("Markdown files found:", files);

    for (const file of files) {
      const filePath = path.join(folder, file);
      const markdown = fs.readFileSync(filePath, "utf-8").trim();

      if (!markdown) {
        console.log(`Skipping empty file: ${file}`);
        continue;
      }

      const richText = await richTextFromMarkdown(markdown);

      if (!richText || !richText.content || richText.content.length === 0) {
        console.log(`Skipping file with empty body after conversion: ${file}`);
        continue;
      }

      const title = file.replace(".md", "");
      const slug = slugify(title, { lower: true });

      const payload = {
        title: { "en-GB": title },
        slug: { "en-GB": slug },
        body: { "en-GB": richText }
      };

      console.log("Creating/updating entry with payload:", {
        title,
        slug,
        richTextLength: richText.content.length
      });

      try {
        const existing = await env.getEntries({
          content_type: "article",
          "fields.slug": slug
        });

        let entry;
        if (existing.items.length > 0) {
          entry = existing.items[0];
          console.log(`Updating existing entry: ${title}`);
          entry.fields = payload;
          await entry.update();
        } else {
          console.log(`Creating new entry: ${title}`);
          entry = await env.createEntry("article", { fields: payload });
        }

        await entry.publish();
        console.log(`Published: ${title}`);
      } catch (err) {
        console.error(`Error creating/publishing entry "${title}":`, err);
      }
    }

    console.log("=== Contentful sync completed ===");
  } catch (err) {
    console.error("Fatal error during sync:", err);
    process.exit(1);
  }
}

run();
