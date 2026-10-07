import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://bantam.trugraph.io",
  integrations: [
    starlight({
      title: "Bantam",
      description: "Plug a leaderboard into any game. Done.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "external", label: "Gamercury Studio", href: "https://gamercury.trugraph.io" },
        {
          icon: "seti:docker",
          label: "Docker Hub: bazokhan/bantam",
          href: "https://hub.docker.com/r/bazokhan/bantam",
        },
      ],
      head: [
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.googleapis.com",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: "anonymous",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;600;700&display=swap",
          },
        },
        {
          tag: "meta",
          attrs: { property: "og:image", content: "https://bantam.trugraph.io/og-image.png" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:secure_url", content: "https://bantam.trugraph.io/og-image.png" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:width", content: "1200" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:height", content: "630" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: "Bantam — leaderboards in one container" },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:image", content: "https://bantam.trugraph.io/og-image.png" },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:image:alt", content: "Bantam — leaderboards in one container" },
        },
        {
          tag: "meta",
          attrs: { name: "theme-color", content: "#0a0214" },
        },
        {
          tag: "script",
          attrs: {
            defer: "",
            src: "https://analytics.trugraph.io/script.js",
            "data-website-id": "520ec161-51d1-492a-92a3-359b2e2df993",
          },
        },
        {
          tag: "script",
          content: `(function(){try{var k='bantam-font';var saved=localStorage.getItem(k);var initial=saved==='system'?'system':'pixel';document.documentElement.dataset.font=initial;function render(){var cur=document.documentElement.dataset.font==='system'?'system':'pixel';var btn=document.getElementById('font-toggle');if(btn){btn.dataset.active=cur;var lbl=btn.querySelector('.label');if(lbl)lbl.textContent=cur==='system'?'System':'Pixel';var g=btn.querySelector('.glyph');if(g)g.textContent=cur==='system'?'Aa':'Px';}}document.addEventListener('DOMContentLoaded',function(){var btn=document.createElement('button');btn.id='font-toggle';btn.className='font-toggle';btn.type='button';btn.setAttribute('aria-label','Toggle font');btn.innerHTML='<span class="glyph">Px</span><span class="label">Pixel</span>';btn.addEventListener('click',function(){var cur=document.documentElement.dataset.font==='system'?'system':'pixel';var next=cur==='system'?'pixel':'system';document.documentElement.dataset.font=next;try{localStorage.setItem(k,next);}catch(e){}render();});document.body.appendChild(btn);render();});}catch(e){}})();`,
        },
      ],
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Bantam", slug: "index" },
            { label: "Your first game in 4 commands", slug: "quickstart" },
          ],
        },
        {
          label: "Authoring",
          items: [
            { label: "Adapter contract", slug: "adapters" },
            { label: "Generic boards (no code)", slug: "generic-boards" },
            { label: "File adapters", slug: "adapter-authoring" },
          ],
        },
        {
          label: "Deploy",
          items: [
            { label: "Docker and Coolify", slug: "deployment" },
            { label: "Manifest and PGS v2", slug: "configuration" },
          ],
        },
        {
          label: "Operate",
          items: [
            { label: "SQLite and backups", slug: "durability" },
            { label: "Security and privacy", slug: "security" },
            { label: "Operations", slug: "operations" },
            { label: "Scaling and migration", slug: "scaling" },
            { label: "Admin dashboard", slug: "admin-dashboard" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "API and SDK", slug: "reference" },
            { label: "Troubleshooting", slug: "troubleshooting" },
            { label: "Versioning and changelog", slug: "changelog" },
          ],
        },
      ],
      lastUpdated: true,
    }),
  ],
});
