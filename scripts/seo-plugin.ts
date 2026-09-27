import type { Plugin } from 'vite';

/*
 * Search-engine basics for the web app: fills the page's public address into index.html
 * and writes robots.txt and sitemap.xml next to it. Players and readers stay out of search
 * results; the pages worth finding are the front pages.
 */

const PAGES = ['', 'manga', 'discover', 'schedule', 'app'];
const OG_IMAGE = 'https://playzae.github.io/playz_anime_landingpage/og.png';

export function seo(base: string): Plugin {
  // PUBLIC_URL is the same setting the server reads (see DEPLOY.md); Render's address is the default.
  const origin = (process.env.PUBLIC_URL || 'https://playz-anime.onrender.com').replace(/\/+$/, '');
  const site = `${origin}${base}`;
  return {
    name: 'playzanime-seo',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', site).replaceAll('%OG_IMAGE%', OG_IMAGE).replaceAll('%BASE%', base),
    generateBundle() {
      const robots = ['User-agent: *', 'Disallow: /api/', 'Disallow: /proxy/', 'Disallow: /watch/', 'Disallow: /read/', '', `Sitemap: ${site}sitemap.xml`, ''];
      const urls = PAGES.map((p) => `  <url><loc>${site}${p}</loc></url>`);
      const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''];
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap.join('\n') });
    },
  };
}
