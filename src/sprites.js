// Puts pixel sprites from the game's atlas into ordinary pages: <img data-icon="fish_tuna_1" data-k="3">
// data-k = how many CSS pixels one sprite pixel should take (default 3).
import { iconURL } from './render.js';

const cache = {};
export const spriteURL = (art, name) => (cache[name] ||= iconURL(art, name));
export function paintIcons(art, root = document) {
  root.querySelectorAll('img[data-icon]').forEach((img) => {
    const i = spriteURL(art, img.dataset.icon), k = Number(img.dataset.k || 3);
    img.src = i.url; img.width = i.w * k; img.height = i.h * k; img.alt = img.alt || '';
  });
}
export const spriteHTML = (art, name, k = 3, alt = '') => { const i = spriteURL(art, name); return `<img class="px" src="${i.url}" width="${i.w * k}" height="${i.h * k}" alt="${alt}">`; };
