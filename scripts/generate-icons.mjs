// Original Abstractus line icons. Raster copies preserve upstream filename contracts.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'src/common/images');
// The same orange book as Desktop, on cobalt with a contrasting edge.
const brand=await fs.readFile(path.join(root,'icons/abstractus-book.svg'),'utf8');
const shapes={
 document:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
 pdf:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M8 16c3-1 5-6 4-6s0 6 4 6c-2-2-6-1-8 0z"/>',
 book:'<path d="M3 5c4-1 7-1 9 1 2-2 5-2 9-1v14c-4-1-7-1-9 1-2-2-5-2-9-1zM12 6v14"/>',
 folder:'<path d="M3 6h7l2 2h9v12H3z"/>',
 webpage:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18z"/>',
 article:'<path d="M3 4h18v16H3zM7 8h4v4H7zM14 8h3M14 12h3M7 16h10"/>',
 note:'<path d="M5 3h14v14l-4 4H5zM15 21v-4h4M8 8h8M8 12h6"/>',
 data:'<path d="M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16"/>',
 media:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>',
 audio:'<path d="M9 18V5l11-2v13M9 9l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 3 4-5 4 6"/>',
 report:'<path d="M5 3h14v18H5zM9 17v-4M12 17V8M15 17v-7"/>',
 thesis:'<path d="m2 8 10-5 10 5-10 5zM6 10v7c4 3 8 3 12 0v-7M22 8v9"/>',
 link:'<path d="m9 15 6-6M8 12l-2 2a4 4 0 0 0 6 6l3-3M16 12l2-2a4 4 0 0 0-6-6l-3 3"/>',
 tick:'<path d="m5 12 4 4L19 6"/>',cross:'<path d="m6 6 12 12M6 18 18 6"/>'
};
function type(name){
 if(/pdf/i.test(name))return 'pdf';if(/collection|multiple|folder/i.test(name))return 'folder';
 if(/book|library|encyclopedia|dictionary/i.test(name))return 'book';
 if(/article|journal|magazine|newspaper/i.test(name))return 'article';if(/webpage|blog|forum/i.test(name))return 'webpage';
 if(/note|letter|manuscript/i.test(name))return 'note';if(/dataset|data/i.test(name))return 'data';
 if(/audio|podcast|radio/i.test(name))return 'audio';if(/video|film|tv|presentation/i.test(name))return 'media';
 if(/artwork|image|map/i.test(name))return 'image';if(/report|patent|bill/i.test(name))return 'report';
 if(/thesis|conference/i.test(name))return 'thesis';if(/link|attachment/i.test(name))return 'link';
 if(/tick/i.test(name))return 'tick';if(/cross/i.test(name))return 'cross';return 'document';
}
const browser=await puppeteer.launch({headless:true});
try {
 const page=await browser.newPage();
 async function render(svg,dest,size){
  await page.setViewport({width:size,height:size,deviceScaleFactor:1});
  await page.setContent('<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>'+svg);
  await fs.mkdir(path.dirname(dest),{recursive:true});await page.screenshot({path:dest,omitBackground:true});
 }
 const skin=path.join(root,'src/zotero/chrome/skin/default/zotero');
 const names=new Set([...(await fs.readdir(skin)).filter(n=>/^(treeitem|treesource)/.test(n)&&n.endsWith('.png')),...(await fs.readdir(assets)).filter(n=>/^(treeitem|treesource)/.test(n)&&n.endsWith('.png')),'cross.png','tick.png','tick@2x.png']);
 for(const name of names){
  const kind=type(name),color=kind==='tick'?'#15803d':kind==='cross'?'#b91c1c':/gray/.test(name)?'#475569':kind==='pdf'?'#c65300':'#203ca5';
  // A light tile + dark border works in toolbars as well as light/dark popups.
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x=".75" y=".75" width="22.5" height="22.5" rx="4" fill="#fffdf9" stroke="#7b8799" stroke-width=".75"/><g transform="translate(2 2) scale(.833333)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes[kind]}</g></svg>`;
  await render(svg,path.join(assets,name),/@48px/.test(name)?48:/@2x/.test(name)?32:16);
 }
 for(const size of [16,32,48,64,128])await render(brand,path.join(root,`icons/Icon-${size}.png`),size);
 const brands=(await fs.readdir(assets)).filter(n=>/^(zotero-(new-)?z-|zotero-app-|abstractus-logo)/.test(n)&&n.endsWith('.png'));
 for(const name of brands)await render(brand,path.join(assets,name),/logo|app-/.test(name)?128:/48px/.test(name)?48:/32px|@2x/.test(name)?32:16);
 for(const platform of ['mac','unix','win'])for(const size of [16,32])await render(brand,path.join(root,`src/browserExt/images/${platform}/zotero-z-${size}px-australis.png`),size);
 await fs.writeFile(path.join(root,'icons/line-icons.json'),JSON.stringify(shapes,null,2)+'\n');
 console.log(`Generated ${names.size} modern item/status icons and full-color Abstractus branding.`);
} finally {await browser.close();}
