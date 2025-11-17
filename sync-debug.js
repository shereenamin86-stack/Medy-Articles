// sync-debug.js
const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');

async function run() {
  try {
    console.log("=== Starting Contentful sync (DEBUG) ===");

    // Check environment variables
    console.log("Environment variables:");
    console.log("CONTENTFUL_SPACE_ID:", process.env.CONTENTFUL_SPACE_ID);
    console.log("CONTENTFUL_ENVIRONMENT:", process.env.CONTENTFUL_ENVIRONMENT);
    console.log("CONTENTFUL_TOKEN present:", process.env.CONTENTFUL_TOKEN ? "Yes" : "No");

    // Connect to Contentful
    const client = createClient({
      accessToken: process.env.CONTENTFUL_TOKEN
    });

    const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
    const env = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT);
    console.log("Connected to Contentful environment:", env.sys.id);

    // Folder with markdown files
    const folder = "./articles";
    if (!fs.existsSync(folder)) {
      console.error("Folder ./articles does NOT exist!");
      return;
    }

    const files = fs.readdirSync(folder).filter(f => f.endsWith(".md"));
    console.log("Markdown files found:", files);

    if (files.length === 0) {
      console.log("No markdown files to process.");
      return;
    }

    for (const file of files) {
      try {
        const filePath = path.join(folder, file);
        const markdown = fs.readFileSync(filePath, "utf-8");

        // Convert Markdown to Contentful Rich Text
        const richText = await richTextFromMarkdown(markdown);

        const title = file.replace(".md", "");
        const slug = slugify(title, { lower: true });

        console.log(`\nProcessing article: ${title}`);
        console.log(`Slug: ${slug}`);

        // Check if article already exists
        const existing = await env.getEntries({
          content_type: "article",
          "fields.slug": slug
        });

        let entry;
        if (existing.items.length > 0) {
          entry = existing.items[0];
          console.log("Updating existing entry in Contentful...");
          entry.fields.title = { "en-GB": title };
          entry.fields.slug = { "en-GB": slug };
          entry.fields.body = { "en-GB": richText };
        } else {
          console.log("Creating new entry in Contentful...");
          entry = await env.createEntry("article", {
            fields: {
              title: { "en-GB": title },
              slug: { "en-GB": slug },
              body: { "en-GB": richText }
            }
          });
        }

        // Publish entry
        await entry.publish();
        console.log(`Published: ${title}`);

      } catch (articleErr) {
        console.error(`Error processing file ${file}:`, articleErr);
      }
    }

    console.log("\n=== Contentful sync (DEBUG) completed ===");

  } catch (err) {
    console.error("Fatal error during sync:", err);
    process.exit(1);
  }
}

// Run the debug sync
run();
