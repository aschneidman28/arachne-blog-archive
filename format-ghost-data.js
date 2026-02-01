const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'Arachne Ghost Data Feb 1 2026.json');
const outputFile = path.join(__dirname, 'Arachne Ghost Data Feb 1 2026 - Formatted.json');

const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const { meta, data } = raw.db[0];

// Build lookup maps
const tagMap = Object.fromEntries(data.tags.map(t => [t.id, t.name]));
const userMap = Object.fromEntries(data.users.map(u => [u.id, u.name]));

// Build post -> tags mapping from the join table
const postTags = {};
for (const pt of data.posts_tags) {
  if (!postTags[pt.post_id]) postTags[pt.post_id] = [];
  postTags[pt.post_id].push(tagMap[pt.tag_id]);
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Separate posts from pages
const posts = data.posts.filter(p => p.type === 'post');
const pages = data.posts.filter(p => p.type === 'page');

const formatted = {
  blog: {
    title: meta.blog_title,
    url: meta.blog_url,
    description: data.settings.find(s => s.key === 'description')?.value || null,
    language: data.settings.find(s => s.key === 'lang')?.value || null,
    timezone: data.settings.find(s => s.key === 'timezone')?.value || null,
    theme: data.settings.find(s => s.key === 'active_theme')?.value || null,
    exported_on: formatDate(meta.exported_on),
    ghost_version: meta.version,
  },
  author: {
    name: data.users[0].name,
    bio: data.users[0].bio,
    website: data.users[0].website,
  },
  tags: data.tags.map(t => ({
    name: t.name,
    description: t.description,
  })),
  posts: posts.map(p => ({
    title: p.title,
    slug: p.slug,
    published: formatDate(p.published_at),
    excerpt: p.custom_excerpt,
    tags: postTags[p.id] || [],
    featured: p.featured,
    feature_image: p.feature_image,
    word_count: p.plaintext ? p.plaintext.split(/\s+/).length : 0,
    content: p.plaintext,
  })),
  pages: pages.map(p => ({
    title: p.title,
    slug: p.slug,
    published: formatDate(p.published_at),
    content: p.plaintext,
  })),
  summary: {
    total_posts: posts.length,
    total_pages: pages.length,
    total_tags: data.tags.length,
    featured_posts: posts.filter(p => p.featured).length,
    total_word_count: posts.reduce((sum, p) => sum + (p.plaintext ? p.plaintext.split(/\s+/).length : 0), 0),
    date_range: {
      earliest: formatDate(posts.map(p => p.published_at).sort()[0]),
      latest: formatDate(posts.map(p => p.published_at).sort().pop()),
    },
    posts_by_tag: data.tags.map(t => ({
      tag: t.name,
      count: data.posts_tags.filter(pt => pt.tag_id === t.id).length,
    })).sort((a, b) => b.count - a.count),
  },
};

fs.writeFileSync(outputFile, JSON.stringify(formatted, null, 2), 'utf8');
console.log(`Formatted file written to: ${outputFile}`);
console.log(`  ${formatted.summary.total_posts} posts, ${formatted.summary.total_pages} pages, ${formatted.summary.total_word_count} total words`);
