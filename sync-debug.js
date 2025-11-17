// sync-debug.js
const fs = require('fs');
const path = require('path');
const { createClient } = require('contentful-management');
const { richTextFromMarkdown } = require('@contentful/rich-text-from-markdown');

// --- CONFIG ---
const ARTICLES_DIR = path.join(__dirname, 'articles');
const LOCALE_PRIMARY = 'en-US'; // required by Contentful
const LOCALE_UK = 'en-GB';      // UK English

// --- CREATE CONTENTFUL CLIENT ---
const client = createClient({
  accessToken: process.env.CONTENTFUL_TOKEN
});

async function run() {
  const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
  const environment = await space.getEnvironment(process.env.CONTENTFUL_ENVIRONMENT);

  // --- LOOP THROUGH ARTICLES ---
  const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(ARTICLES_DIR, file);
    const markdown = fs.readFileSync(filePath, 'utf-8');

    const title = path.basename(file, '.md');
    const slug = title.toLowerCase().replace(/\s+/g, '_');

    // Convert Markdown to Rich Text
    let richText = await richTextFromMarkdown(markdown);

    // Fallback if conversion is empty
    if (!richText || !richText.content || richText.content.length === 0) {
      richText = {
        nodeType: 'document',
        data: {},
        content: [
          {
            nodeType: 'paragraph',
            data: {},
            content: [
              { nodeType: 'text', value: markdown || "No content", marks: [], data: {} }
            ]
          }
        ]
      };
    }

    // --- BUILD PAYLOAD WITH BOTH LOCALES ---
    const payload = {
      title: { [LOCALE_PRIMARY]: title, [LOCALE_UK]: title },
      slug: { [LOCALE_PRIMARY]: slug, [LOCALE_UK]: slug },
      body: { [LOCALE_PRIMARY]: richText, [LOCALE_UK]: richText }
    };

    // --- DEBUG PREVIEW ---
    function getBodyTextPreview(richText) {
      if (!richText || !richText.content) return "<empty>";
      const paragraphs = richText.content
        .filter(n => n.nodeType === "paragraph")
        .map(p => p.content.map(c => c.value).join(""))
        .filter(t => t.trim() !== "");
      return paragraphs.slice(0,3).join("\n\n") || "<empty>";
    }

    console.log("=== Article Debug Preview ===");
    console.log("Title:", title);
    console.log("Slug:", slug);
    console.log("Body preview (first 3 paragraphs):\n", getBodyTextPreview(richText));
    console.log("=============================");

    // --- CREATE OR UPDATE ENTRY ---
    try {
      let entry;
      const entries = await environment.getEntries({ content_type: 'article', 'fields.slug': slug });
      if (entries.items.length > 0) {
        entry = entries.items[0];
        entry.fields = payload;
        await entry.update();
        console.log(`Updated entry: ${title}`);
      } else {
        entry = await environment.createEntry('article', { fields: payload });
        console.log(`Created new entry: ${title}`);
      }

      // Publish the entry
      if (!entry.isPublished()) {
        await entry.publish();
        console.log(`Published entry: ${title}`);
      }
    } catch (err) {
      console.error(`Error syncing article ${title}:`, err);
    }
  }
}

// --- ERROR HANDLING ---
process.on('uncaughtException', err => { console.error('Uncaught Exception:', err); process.exit(1); });
process.on('unhandledRejection', err => { console.error('Unhandled Rejection:', err); process.exit(1); });

// --- RUN SCRIPT ---
run();
