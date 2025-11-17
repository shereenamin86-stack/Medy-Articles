const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');

async function run() {
  try {
    // Catch unhandled errors so workflow logs full details
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    process.on('uncaughtException', err => {
      console.error('Uncaught Exception thrown:', err);
    });

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

      // Skip completely empty files
      if (!markdown.trim()) {
        console.log(`Skipping empty file: ${file}`);
        continue;
      }

      // Convert Markdown → Rich Text
      const richText = await richTextFromMarkdown(markdown);

      // Skip if Rich Text is empty
      if (!richText || !richText.content || richText.content.length === 0) {
        console.log(`Skipping file with empty body: ${file}`);
        continue;
      }

      const title = file.replace(".md", "");
      const slug = slugify(title, { lower: true });

      // Prepare payload including all required fields
      const payload = {
        title: { "en-GB": title },
        slug: { "en-GB": slug },
        body: { "en-GB": richText },
        // Add placeholders for any other required fields in your content type:
        // summary: { "en-GB": "Summary placeholder" },
        // publishDate: { "en-GB": new Date().toISOString() },
        // author: { "en-GB": { sys: { type: "Link", linkType: "Entry", id: "authorEntryId" } } }
      };

      // Debug log payload
      console.log("Creating entry with payload:", {
