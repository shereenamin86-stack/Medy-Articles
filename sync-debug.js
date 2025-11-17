const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');

async function run() {
  try {
    // Connect to Contentful
    const client = createClient({ accessToken: process.env.CONTENTFUL_TOKEN });
    const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
    const env = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT);

    const folder = "./articles";
    const files = fs.readdirSync(folder).filter(f => f.endsWith(".md"));

    console.log("Markdown files found:", files);

    for (const file of files) {
      const filePath = path.join(folder, file);
      const markdown = fs.readFileSync(filePath, "utf-8");

      if (!markdown.trim()) {
        console.log(`Skipping empty file: ${file}`);
        continue;
      }

      const richText = await richTextFromMarkdown(markdown);

      const title = file.replace(".md", "");
      const slug = slugify(title, { lower: true });

      console.log(`Processing file: ${file}`);
      console.log("Title:", title);
      console.log("Slug:", slug);
      console.log("RichText length:", richText.content.length);

      const existing = await env.getEntries({
        content_type: "article",
        "fields.slug": slug
      });

      let entry;
      if (existing.items.length > 0) {
        entry = existing.items[0];
        console.log(`Updating existing entry: ${title}`);
        entry.fields.title = { "en-GB": title };
        entry.fields.slug = { "en-GB": slug };
        entry.fields.body = { "en-GB": richText };
      } else {
        console.log(`Creating new entry: ${title}`);
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

    console.log("=== Contentful sync completed ===");
  } catch (err) {
    console.error("Fatal error during sync:", err);
    process.exit(1);
  }
}

run();
