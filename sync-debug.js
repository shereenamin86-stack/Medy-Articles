// sync-debug.js
// Sync markdown files in ./articles -> Contentful (article content type)
// Field IDs used: title, slug, body, references
// Locales: en-US (primary), en-GB (UK)

const fs = require('fs');
const path = require('path');
const slugify = require('slugify');
const { createClient } = require('contentful-management');
const { unified } = require('unified');
const remarkParse = require('remark-parse');
const remarkGfm = require('remark-gfm');
const remarkFootnotes = require('remark-footnotes');
const remarkRehype = require('remark-rehype');
const rehypeStringify = require('rehype-stringify');
const { parse } = require('node-html-parser');
const { BLOCKS } = require('@contentful/rich-text-types');

// --- ENVIRONMENT CHECK ---
const SPACE_ID = process.env.CONTENTFUL_SPACE_ID;
const ENVIRONMENT = process.env.CONTENTFUL_ENVIRONMENT;
const TOKEN = process.env.CONTENTFUL_TOKEN;

if (!SPACE_ID || !ENVIRONMENT || !TOKEN) {
  console.error('ERROR: Missing environment variables. Please set CONTENTFUL_SPACE_ID, CONTENTFUL_ENVIRONMENT, CONTENTFUL_TOKEN');
  process.exit(1);
}

// create Contentful client
const client = createClient({ accessToken: TOKEN });

// constants
const ARTICLES_DIR = path.join(__dirname, 'articles');
const LOCALE_PRIMARY = 'en-US';
const LOCALE_UK = 'en-GB';

// --- Helper: Convert Markdown -> HTML (remark with GFM + footnotes) ---
async function markdownToHtml(markdown) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFootnotes, { inlineNotes: true })
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

// --- Helper: Map HTML -> Contentful Rich Text nodes (best-effort) ---
function htmlToRichDocument(html) {
  const root = parse(html);
  const bodyNodes = [];

  // extract footnotes section if present
  const footnotesSection = root.querySelector('.footnotes') || root.querySelector('section.footnotes');
  let footnoteParagraphs = [];
  if (footnotesSection) {
    const lis = footnotesSection.querySelectorAll('li');
    footnoteParagraphs = lis.map(li => ({
      nodeType: BLOCKS.PARAGRAPH,
      content: [{ nodeType: 'text', value: li.text.trim(), marks: [], data: {} }],
      data: {}
    }));
    footnotesSection.remove(); // prevent duplication when mapping DOM
  }

  // recursive mapping of nodes
  function mapNode(node) {
    const nodes = [];
    if (!node) return nodes;

    // text node
    if (node.nodeType === 3) {
      const txt = node.rawText;
      if (txt && txt.trim()) nodes.push({ nodeType: 'text', value: txt, marks: [], data: {} });
      return nodes;
    }

    const tag = (node.tagName || '').toLowerCase();

    if (tag === 'p') {
      const content = node.childNodes.map(mapNode).flat();
      if (content.length) nodes.push({ nodeType: BLOCKS.PARAGRAPH, content, data: {} });
      return nodes;
    }

    if (/^h[1-6]$/.test(tag)) {
      const text = node.text.trim();
      // map to heading level 2 (safe) — change to HEADING_1 etc if desired
      nodes.push({
        nodeType: BLOCKS.HEADING_2,
        content: [{ nodeType: 'text', value: text, marks: [], data: {} }],
        data: {}
      });
      return nodes;
    }

    if (tag === 'ul' || tag === 'ol') {
      const listType = tag === 'ul' ? BLOCKS.UL_LIST : BLOCKS.OL_LIST;
      const items = node.querySelectorAll('li').map(li => ({
        nodeType: BLOCKS.LIST_ITEM,
        content: [{
          nodeType: BLOCKS.PARAGRAPH,
          content: li.childNodes.map(mapNode).flat(),
          data: {}
        }],
        data: {}
      }));
      nodes.push({ nodeType: listType, content: items, data: {} });
      return nodes;
    }

    if (tag === 'pre' || tag === 'code') {
      const codeText = node.text;
      nodes.push({
        nodeType: BLOCKS.PARAGRAPH,
        content: [{ nodeType: 'text', value: codeText, marks: [], data: {} }],
        data: {}
      });
      return nodes;
    }

    if (tag === 'table') {
      // best-effort fallback: create a readable text table
      const rows = node.querySelectorAll('tr').map(tr => {
        const cells = tr.querySelectorAll('th,td').map(c => c.text.trim());
        return '| ' + cells.join(' | ') + ' |';
      }).join('\n');
      nodes.push({
        nodeType: BLOCKS.PARAGRAPH,
        content: [{ nodeType: 'text', value: rows, marks: [], data: {} }],
        data: {}
      });
      return nodes;
    }

    if (tag === 'sup') {
      const t = node.text.trim();
      if (t) nodes.push({ nodeType: 'text', value: `(${t})`, marks: [], data: {} });
      return nodes;
    }

    // generic container: map children and wrap them in paragraphs if top-level
    if (node.childNodes && node.childNodes.length) {
      const childContent = node.childNodes.map(mapNode).flat();
      if (childContent.length) {
        // if child content are text nodes only, wrap as paragraph
        nodes.push({
          nodeType: BLOCKS.PARAGRAPH,
          content: childContent,
          data: {}
        });
      }
      return nodes;
    }

    return nodes;
  }

  // map top-level children
  const topChildren = root.childNodes.length ? root.childNodes : [root];
  topChildren.forEach(child => {
    const mapped = mapNode(child);
    mapped.forEach(n => bodyNodes.push(n));
  });

  // append footnotes (if any)
  if (footnoteParagraphs.length) {
    bodyNodes.push({
      nodeType: BLOCKS.HEADING_2,
      content: [{ nodeType: 'text', value: 'Footnotes', marks: [], data: {} }],
      data: {}
    });
    footnoteParagraphs.forEach(p => bodyNodes.push(p));
  }

  return { nodeType: 'document', data: {}, content: bodyNodes };
}

// --- Helper: extract References section from raw markdown ---
// returns { bodyMarkdown, referencesMarkdown }
function extractReferencesSection(rawMarkdown) {
  const lines = rawMarkdown.split(/\r?\n/);
  // find a heading that matches References (## References)
  const idx = lines.findIndex(line => /^\s*#{1,6}\s*references\s*$/i.test(line.trim()));
  if (idx === -1) return { bodyMarkdown: rawMarkdown, referencesMarkdown: '' };
  const bodyMarkdown = lines.slice(0, idx).join('\n').trim();
  const referencesMarkdown = lines.slice(idx).join('\n').trim();
  return { bodyMarkdown, referencesMarkdown };
}

// --- Main converter: markdown -> richText (with references extraction + validation) ---
async function markdownToRichTextWithReferences(rawMarkdown) {
  // extract references section
  const { bodyMarkdown, referencesMarkdown } = extractReferencesSection(rawMarkdown);

  // Convert bodyMarkdown to HTML (remark)
  const bodyHtml = await markdownToHtml(bodyMarkdown);
  const bodyRich = htmlToRichDocument(bodyHtml);

  // Convert referencesMarkdown to HTML -> Rich
  let referencesRich = null;
  if (referencesMarkdown && referencesMarkdown.trim()) {
    const refsHtml = await markdownToHtml(referencesMarkdown);
    referencesRich = htmlToRichDocument(refsHtml);
  } else {
    // attempt to extract footnotes from bodyHtml if no explicit References section
    const possibleHtml = await markdownToHtml(rawMarkdown);
    const root = parse(possibleHtml);
    const footnotesSec = root.querySelector('.footnotes') || root.querySelector('section.footnotes');
    if (footnotesSec) {
      // map footnotes to paragraphs
      const lis = footnotesSec.querySelectorAll('li');
      const footnoteParas = lis.map(li => ({
        nodeType: BLOCKS.PARAGRAPH,
        content: [{ nodeType: 'text', value: li.text.trim(), marks: [], data: {} }],
        data: {}
      }));
      referencesRich = { nodeType: 'document', data: {}, content: footnoteParas };
    }
  }

  return { bodyRich, referencesRich, bodyMarkdown, referencesMarkdown };
}

// --- Main sync runner ---
async function run() {
  try {
    const space = await client.getSpace(SPACE_ID);
    const env = await space.getEnvironment(ENVIRONMENT);
    console.log('Connected to Contentful space:', SPACE_ID, 'env:', ENVIRONMENT);

    // Ensure articles dir exists
    if (!fs.existsSync(ARTICLES_DIR)) {
      console.error('ERROR: articles directory not found at', ARTICLES_DIR);
      process.exit(1);
    }

    const files = fs.readdirSync(ARTICLES_DIR).filter(f => f.endsWith('.md'));
    console.log('Markdown files found:', files);

    for (const file of files) {
      try {
        const filePath = path.join(ARTICLES_DIR, file);
        const rawMarkdown = fs.readFileSync(filePath, 'utf8') || '';
        if (!rawMarkdown.trim()) {
          console.log(`Skipping empty file: ${file}`);
          continue;
        }

        const title = path.basename(file, '.md');
        const slug = slugify(title, { lower: true, strict: true });

        // Convert and extract references
        const { bodyRich, referencesRich, bodyMarkdown, referencesMarkdown } =
          await markdownToRichTextWithReferences(rawMarkdown);

        // Validation: title must exist
        if (!title || !title.trim()) {
          console.error(`Skipping file ${file} because title is empty`);
          continue;
        }

        // Validation: Ensure bodyRich has content; if not, create a fallback paragraph with bodyMarkdown
        let finalBody = bodyRich;
        if (!finalBody || !finalBody.content || finalBody.content.length === 0) {
          finalBody = {
            nodeType: 'document',
            data: {},
            content: [{
              nodeType: BLOCKS.PARAGRAPH,
              content: [{ nodeType: 'text', value: bodyMarkdown || 'No content', marks: [], data: {} }],
              data: {}
            }]
          };
        }

        // If referencesRich is null, set to empty document
        const finalReferences = referencesRich && referencesRich.content && referencesRich.content.length > 0
          ? referencesRich
          : { nodeType: 'document', data: {}, content: [] };

        // Build payload with both locales to satisfy locale requirements
        const payload = {
          title: { [LOCALE_PRIMARY]: title, [LOCALE_UK]: title },
          slug: { [LOCALE_PRIMARY]: slug, [LOCALE_UK]: slug },
          body: { [LOCALE_PRIMARY]: finalBody, [LOCALE_UK]: finalBody },
          references: { [LOCALE_PRIMARY]: finalReferences, [LOCALE_UK]: finalReferences }
        };

        // Debug preview (concise)
        function getBodyPreview(rich) {
          if (!rich || !rich.content) return '<empty>';
          const ps = rich.content
            .filter(n => n.nodeType === BLOCKS.PARAGRAPH)
            .map(p => (p.content || []).map(c => c.value || '').join(''))
            .filter(t => t.trim());
          return ps.slice(0, 3).join('\n\n') || '<empty>';
        }

        console.log('--- Syncing article:', title, '---');
        console.log('Slug:', slug);
        console.log('Body preview:\n', getBodyPreview(finalBody));
        console.log('References preview:\n', getBodyPreview(finalReferences));
        console.log('---');

        // Create or update entry
        try {
          const existing = await env.getEntries({ content_type: 'article', 'fields.slug': slug, limit: 1 });
          let entry;
          if (existing.items && existing.items.length > 0) {
            entry = existing.items[0];
            entry.fields = payload;
            await entry.update();
            console.log(`Updated entry: ${title}`);
          } else {
            entry = await env.createEntry('article', { fields: payload });
            console.log(`Created new entry: ${title}`);
          }

          // Publish (only if not already published)
          if (!entry.isPublished || !entry.isPublished()) {
            // older SDK may not have isPublished method; use sys publishedAt check
            try {
              await entry.publish();
              console.log(`Published: ${title}`);
            } catch (pubErr) {
              // If already published or other issue, log and continue
              console.warn('Publish warning:', pubErr && pubErr.message ? pubErr.message : pubErr);
            }
          } else {
            console.log(`Entry already published: ${title}`);
          }
        } catch (errCreate) {
          console.error(`Error creating/updating entry for "${title}":`);
          console.error('Payload:', JSON.stringify(payload, null, 2));
          if (errCreate.response && errCreate.response.data) {
            console.error('Contentful response data:', JSON.stringify(errCreate.response.data, null, 2));
          } else {
            console.error(errCreate);
          }
          // continue with next file
          continue;
        }
      } catch (fileErr) {
        console.error('Error processing file', file, fileErr);
        continue;
      }
    } // end for files

    console.log('=== All files processed ===');
  } catch (err) {
    console.error('Fatal error during sync:', err);
    process.exit(1);
  }
}

// global handlers
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// run
run();
