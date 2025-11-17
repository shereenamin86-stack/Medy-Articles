const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');

async function run() {
  try {
    console.log("Starting sync...");

    // Connect to Contentful
    const client = createClient({
      accessToken: process.env.CONTENTFUL_TOKEN
    });

    const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
    const env = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT);

    // Loop through all markdown files
    const folder = "./articles";
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".md"));

    if (files.length === 0) {
      console.log("No markdown files found in /articles.");
      return;
    }

    for (const file of files) {
      const filePath = path.join(folder, file);
      const markdown = fs.readFileSync(filePath, "utf-8");

      // Convert Markdown to Rich Text
      const richText = await richTextFromMarkdown(markdown);

      // Use filename as the title
      const title = file.replace(".md", "");
      const slug = slugify(title, { lower: true });

      console.log(`Processing: ${title}`);

      // Check if article already exists
      const existing = await env.getEntries({
        content_type: "article",
        "fields.slug": slug
      });

      let entry;

      if (existing.items.length > 0) {
        entry = existing.items[0];
        console.log(`Updating existing article: ${title}`);

        entry.fields.title = { "en-GB": title };
        entry.fields.slug = { "en-GB": slug };
        entry.fields.body = { "en-GB": richText };

      } else {
        console.log(`Creating new article: ${title}`);

        entry = await env.createEntry("article", {
          fields: {
            title: { "en-GB": title },
            slug: { "en-GB": slug },
            body: { "en-GB": richText }
          }
        });
      }

      await entry.publish();
      console.log(`Published: ${title}`);
    }

    console.log("Sync complete!");

  } catch (err) {
    console.error("Error during sync:", err);
    process.exit(1);
  }
}

run();
